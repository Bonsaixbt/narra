/** Orchestration: embeddings cache, semantic neighbour pairs, cluster naming with a daily budget. */
import type { Store } from "../store/db.js";
import type { TokenInfo } from "../analyze/types.js";
import { cosine, createEmbedder, createNamer, embedText, semanticConfig, type ClusterNamingInput, type Embedder, type Namer, type SemanticConfig } from "./provider.js";

import { categoryAnchors, applyCategories } from "./taxonomy.js";

export interface SemanticState { cfg: SemanticConfig; embedder: Embedder | null; namer: Namer | null; errors: string[]; anchors?: Map<string, Float32Array[]> }

/** Category tags for a token list (needs cached embeddings). Anchors are embedded once per process. */
export async function categorize(store: Store, st: SemanticState, tokens: TokenInfo[]): Promise<number> {
  if (!st.embedder || process.env.NARRA_SEMANTIC_CATEGORIES === "off") return 0;
  if (!st.anchors) st.anchors = await categoryAnchors(st.embedder);
  return applyCategories(store, st.embedder.model, st.anchors, tokens);
}

export async function initSemantic(override?: { off?: boolean }): Promise<SemanticState> {
  const cfg = semanticConfig(process.env, override);
  const st: SemanticState = { cfg, embedder: null, namer: null, errors: [] };
  if (!cfg.enabled) return st;
  try { st.embedder = await createEmbedder(cfg); } catch (e) { st.errors.push((e as Error).message); }
  try { st.namer = await createNamer(cfg); } catch (e) { st.errors.push((e as Error).message); }
  return st;
}

/** Make sure every token has an embedding in the cache; returns how many were computed now. */
export async function ensureEmbeddings(store: Store, st: SemanticState, tokens: TokenInfo[]): Promise<number> {
  if (!st.embedder) return 0;
  const model = st.embedder.model;
  const have = store.embeddingsFor(tokens.map((t) => t.token), model);
  const missing = tokens.filter((t) => !have.has(t.token) && (t.name || t.symbol));
  if (!missing.length) return 0;
  const vecs = await st.embedder.embed(missing.map(embedText));
  store.putEmbeddings(missing.map((t, i) => ({ token: t.token, model, vec: vecs[i] })));
  return missing.length;
}

/**
 * Pairs (i, j, score) of tokens that mean the same thing. Embedding models compress similarity into a narrow band
 * (e5 puts unrelated meme names at 0.75–0.83), so an absolute floor alone chains everything. Three gates:
 *   1. absolute floor `threshold`;
 *   2. relative: the pair sits ≥ `zGate` standard deviations above the token's mean similarity to all others;
 *   3. mutual k-NN: each token is among the other's top-k neighbours.
 */
export function semanticPairs(store: Store, st: SemanticState, tokens: TokenInfo[], k = 3, zGate = 2.5): [number, number, number][] {
  if (!st.embedder) return [];
  const vecs = store.embeddingsFor(tokens.map((t) => t.token), st.embedder.model);
  const idx: number[] = [], V: Float32Array[] = [];
  tokens.forEach((t, i) => { const v = vecs.get(t.token); if (v) { idx.push(i); V.push(v); } });
  const n = V.length;
  if (n < 3) return [];
  const sum = new Float64Array(n), sq = new Float64Array(n);
  const cand = new Map<number, [number, number][]>();
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const s = cosine(V[a], V[b]);
      sum[a] += s; sq[a] += s * s; sum[b] += s; sq[b] += s * s;
      if (s < st.cfg.threshold) continue;
      (cand.get(a) ?? cand.set(a, []).get(a)!).push([b, s]);
      (cand.get(b) ?? cand.set(b, []).get(b)!).push([a, s]);
    }
  }
  const mean = (x: number) => sum[x] / (n - 1);
  const sd = (x: number) => Math.sqrt(Math.max(0, sq[x] / (n - 1) - mean(x) ** 2)) || 0.01;
  const top = new Map<number, Map<number, number>>();
  for (const [x, list] of cand) {
    const gate = n >= 20 ? mean(x) + zGate * sd(x) : st.cfg.threshold; // the relative gate needs a population
    const kept = list.filter(([, s]) => s >= gate).sort((p, q) => q[1] - p[1]).slice(0, k);
    top.set(x, new Map(kept));
  }
  const out: [number, number, number][] = [];
  for (const [x, nb] of top) for (const [y, s] of nb) if (x < y && top.get(y)?.has(x)) out.push([idx[x], idx[y], s]);
  return out;
}

function today(): string { return new Date().toISOString().slice(0, 10); }

export function budgetLeft(store: Store, st: SemanticState): number {
  const used = Number(store.get(`semantic_calls:${today()}`) ?? 0);
  return Math.max(0, st.cfg.budgetPerDay - used);
}
function spend(store: Store, n = 1): void { const k = `semantic_calls:${today()}`; store.set(k, String(Number(store.get(k) ?? 0) + n)); }

/** Label + summary for a cluster, cached by the set of its top members. */
export async function nameCluster(store: Store, st: SemanticState, input: ClusterNamingInput, memberKey: string): Promise<{ label: string; summary: string; source: "cache" | "model" } | null> {
  if (!st.namer) return null;
  const cached = store.getClusterLabel(memberKey, st.namer.model);
  if (cached) return { ...cached, source: "cache" };
  if (budgetLeft(store, st) <= 0) return null;
  spend(store);
  try {
    const r = await st.namer.name(input);
    store.putClusterLabel(memberKey, st.namer.model, r.label, r.summary);
    return { ...r, source: "model" };
  } catch (e) { st.errors.push(`naming: ${(e as Error).message.split("\n")[0]}`); return null; }
}
