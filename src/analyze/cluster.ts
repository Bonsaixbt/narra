/**
 * Tokens → clusters. Two tokens are linked when their tags are close, or they share buyers, or they share a deployer
 * and at least one content tag. Connected components of that graph are the metas.
 */
import { similarity, isContentTag, isCategoryTag, type Tags } from "./tokenize.js";
import type { TokenInfo } from "./types.js";

export interface ClusterOptions {
  /** A content tag needs this many tokens in the window before it can link anything. */
  minTagSupport: number;
  /** Weighted Jaccard at or above this links two tokens. */
  simThreshold: number;
  /** Shared buyers at or above this links two tokens regardless of names. */
  minBuyerOverlap: number;
  /** Shared buyers must also be at least this share of the smaller token's buyer set. */
  minBuyerShare: number;
  /** Two name-groups merge only when at least this many distinct token pairs across them share a crowd. */
  minWalletPairsToMerge: number;
  /** Components smaller than this are not published. */
  minSize: number;
  /** A component larger than this is re-clustered with stricter thresholds; single-linkage otherwise chains a whole chain into one blob. */
  maxSize: number;
  /** When splitting an oversized component, only semantic pairs at or above this cosine survive. */
  semanticSplitFloor: number;
  /** A deployer with more launches than this in the window is a farm: a printer, not a meta. Its tokens get no deployer links. */
  maxDeployerFan: number;
  /** Wallets that bought more than this many tokens are bots/routers and do not vote. */
  maxTokensPerWallet: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { minTagSupport: 3, simThreshold: 0.35, minBuyerOverlap: 5, minBuyerShare: 0.2, minWalletPairsToMerge: 2, minSize: 3, maxSize: 60, semanticSplitFloor: 0.9, maxDeployerFan: 8, maxTokensPerWallet: 60 };

export interface RawCluster {
  id: number;
  members: string[];
  centroid: Tags;
  top_tags: { tag: string; weight: number }[];
  slug: string;
  /** token → 0..1 how firmly it sits in this cluster */
  membership: Map<string, number>;
  /** token → number of other members it is directly linked to */
  degree: Map<string, number>;
  /** how many links of each kind hold the cluster together */
  links: { text: number; wallet: number; deployer: number; semantic: number };
}

class UnionFind {
  private p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a: number, b: number): void { const x = this.find(a), y = this.find(b); if (x !== y) this.p[x] = y; }
}

export function buyersByToken(trades: { token: string | null; side: string; recipient: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const t of trades) {
    if (!t.token || t.side !== "buy") continue;
    let s = m.get(t.token); if (!s) { s = new Set(); m.set(t.token, s); }
    s.add(t.recipient);
  }
  return m;
}

/** Drop wallets that bought more than `maxTokens` distinct tokens: snipers and routers link everything to everything. */
export function dropSprayers(buyers: Map<string, Set<string>>, maxTokens: number): { buyers: Map<string, Set<string>>; dropped: number } {
  const count = new Map<string, number>();
  for (const set of buyers.values()) for (const w of set) count.set(w, (count.get(w) ?? 0) + 1);
  const bad = new Set([...count].filter(([, n]) => n > maxTokens).map(([w]) => w));
  const out = new Map<string, Set<string>>();
  for (const [token, set] of buyers) { const s = new Set([...set].filter((w) => !bad.has(w))); if (s.size) out.set(token, s); }
  return { buyers: out, dropped: bad.size };
}

/**
 * Clusters with a size guard: any component above `maxSize` is re-clustered on its own members with a stricter
 * similarity threshold and a higher buyer-share floor, up to `depth` times. What still will not split is kept as is.
 */
export type SemanticPair = [number, number, number];

export function buildClusters(tokens: TokenInfo[], buyers: Map<string, Set<string>>, opts: ClusterOptions = DEFAULT_CLUSTER_OPTIONS, depth = 4, semantic: SemanticPair[] = []): RawCluster[] {
  const first = buildClustersOnce(tokens, buyers, opts, semantic);
  if (depth <= 0) return first;
  const byToken = new Map(tokens.map((t) => [t.token, t]));
  const out: RawCluster[] = [];
  for (const c of first) {
    if (c.members.length <= opts.maxSize) { out.push(c); continue; }
    const stricter: ClusterOptions = { ...opts, simThreshold: Math.min(0.9, opts.simThreshold + 0.12), minBuyerShare: Math.min(0.8, opts.minBuyerShare + 0.15), minBuyerOverlap: opts.minBuyerOverlap + 3, minTagSupport: opts.minTagSupport + 1 };
    const subTokens = c.members.map((m) => byToken.get(m)!);
    const local = new Map(subTokens.map((t, i) => [t.token, i]));
    const subSem: SemanticPair[] = semantic.flatMap(([a, b, sc]) => { const x = local.get(tokens[a].token), y = local.get(tokens[b].token); return x !== undefined && y !== undefined && sc >= opts.semanticSplitFloor ? [[x, y, sc] as SemanticPair] : []; });
    const sub = buildClusters(subTokens, buyers, stricter, depth - 1, subSem);
    if (sub.length === 1 && sub[0].members.length === c.members.length) { out.push(c); continue; }
    out.push(...sub);
  }
  return out.sort((a, b) => b.members.length - a.members.length).map((c, i) => ({ ...c, id: i }));
}

function buildClustersOnce(tokens: TokenInfo[], buyers: Map<string, Set<string>>, opts: ClusterOptions, semantic: SemanticPair[] = []): RawCluster[] {
  const idx = new Map(tokens.map((t, i) => [t.token, i]));
  const uf = new UnionFind(tokens.length);
  const degree = new Map<string, number>();
  const linkKind = new Map<string, "text" | "wallet" | "deployer" | "semantic">();
  const link = (a: number, b: number, kind: "text" | "wallet" | "deployer" | "semantic") => {
    if (a === b) return;
    linkKind.set(a < b ? `${a}:${b}` : `${b}:${a}`, kind);
    uf.union(a, b);
    degree.set(tokens[a].token, (degree.get(tokens[a].token) ?? 0) + 1);
    degree.set(tokens[b].token, (degree.get(tokens[b].token) ?? 0) + 1);
  };
  const linked = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // launch farms: deployers printing more than maxDeployerFan tokens in the window do not glue anything
  const fan = new Map<string, number>();
  for (const t of tokens) fan.set(t.deployer, (fan.get(t.deployer) ?? 0) + 1);
  const isFarm = (d: string) => (fan.get(d) ?? 0) > opts.maxDeployerFan;

  // 1. text: inverted index on content tags with enough support
  const byTag = new Map<string, number[]>();
  tokens.forEach((t, i) => { for (const tag of t.tags.keys()) if (isContentTag(tag) && !isCategoryTag(tag)) { let l = byTag.get(tag); if (!l) { l = []; byTag.set(tag, l); } l.push(i); } });
  for (const [, list] of byTag) {
    if (list.length < opts.minTagSupport || list.length > 400) continue;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const a = list[x], b = list[y], k = key(a, b);
      if (linked.has(k)) continue;
      const ta = tokens[a], tb = tokens[b];
      if (similarity(ta.tags, tb.tags) >= opts.simThreshold) { linked.add(k); link(a, b, "text"); }
      else if (ta.deployer === tb.deployer && !isFarm(ta.deployer)) { linked.add(k); link(a, b, "deployer"); }
    }
  }

  // 1b. semantic: embedding neighbours (already thresholded and k-capped by the caller)
  for (const [a, b] of semantic) { const k = key(a, b); if (!linked.has(k)) { linked.add(k); link(a, b, "semantic"); } }

  // 2. wallets: co-occurrence of buyers across tokens. Wallet links are weaker than name links: they merge two
  //    name-groups only when at least two distinct token pairs across the groups share a crowd, so one busy wallet
  //    set cannot chain every copycat group on the chain into a single blob.
  const walletTokens = new Map<string, number[]>();
  for (const [token, set] of buyers) {
    const i = idx.get(token); if (i === undefined) continue;
    for (const w of set) { let l = walletTokens.get(w); if (!l) { l = []; walletTokens.set(w, l); } l.push(i); }
  }
  const pairCount = new Map<string, number>();
  for (const [, list] of walletTokens) {
    if (list.length < 2 || list.length > opts.maxTokensPerWallet) continue;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const k = key(list[x], list[y]);
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }
  }
  const groupSize = new Map<number, number>();
  tokens.forEach((_, i) => { const r = uf.find(i); groupSize.set(r, (groupSize.get(r) ?? 0) + 1); });
  const groupLinks = new Map<string, { pairs: [number, number][]; need: number }>();
  for (const [k, n] of pairCount) {
    if (n < opts.minBuyerOverlap || linked.has(k)) continue;
    const [a, b] = k.split(":").map(Number);
    const sa = buyers.get(tokens[a].token)?.size ?? 0, sb = buyers.get(tokens[b].token)?.size ?? 0;
    if (n < opts.minBuyerShare * Math.min(sa, sb)) continue;
    const ga = uf.find(a), gb = uf.find(b);
    if (ga === gb) { linked.add(k); link(a, b, "wallet"); continue; } // inside a name-group: just strengthens degree
    const gk = ga < gb ? `${ga}:${gb}` : `${gb}:${ga}`;
    let gl = groupLinks.get(gk);
    if (!gl) { gl = { pairs: [], need: Math.min(opts.minWalletPairsToMerge, (groupSize.get(ga) ?? 1) * (groupSize.get(gb) ?? 1)) }; groupLinks.set(gk, gl); }
    gl.pairs.push([a, b]);
  }
  for (const [, gl] of groupLinks) {
    if (gl.pairs.length < gl.need) continue;
    for (const [a, b] of gl.pairs) { const k = key(a, b); if (!linked.has(k)) { linked.add(k); link(a, b, "wallet"); } }
  }

  // 3. components → clusters
  const groups = new Map<number, number[]>();
  tokens.forEach((_, i) => { const r = uf.find(i); let g = groups.get(r); if (!g) { g = []; groups.set(r, g); } g.push(i); });
  const out: RawCluster[] = [];
  let id = 0;
  for (const [, g] of groups) {
    if (g.length < opts.minSize) continue;
    const members = g.map((i) => tokens[i]);
    const centroid = centroidOf(members.map((m) => m.tags));
    const top = topTags(centroid, members);
    const membership = new Map<string, number>();
    for (const m of members) {
      const deg = degree.get(m.token) ?? 0;
      const degScore = Math.min(1, deg / Math.max(1, Math.min(members.length - 1, 6)));
      const sim = similarity(m.tags, centroid);
      membership.set(m.token, round2(0.5 * degScore + 0.5 * Math.min(1, sim * 2)));
    }
    const links = { text: 0, wallet: 0, deployer: 0, semantic: 0 };
    const gi = new Set(g);
    for (const [k, kind] of linkKind) { const [a, b] = k.split(":").map(Number); if (gi.has(a) && gi.has(b)) links[kind]++; }
    // Wallet-only clusters share a crowd, not a word: name them after their two most-bought members.
    const fallback = top.length ? [] : [...members].sort((x, y) => (buyers.get(y.token)?.size ?? 0) - (buyers.get(x.token)?.size ?? 0)).slice(0, 2)
      .map((m) => [...m.tags.keys()].find(isContentTag) ?? m.symbol.toLowerCase()).filter(Boolean).map((tag) => ({ tag, weight: 0.01 }));
    out.push({ id: id++, members: members.map((m) => m.token), centroid, top_tags: top.length ? top : fallback, slug: slugOf(top.length ? top : fallback, id), membership, degree, links });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

export function centroidOf(all: Tags[]): Tags {
  const sum: Tags = new Map();
  for (const t of all) for (const [k, w] of t) sum.set(k, (sum.get(k) ?? 0) + w);
  const c: Tags = new Map();
  for (const [k, v] of sum) c.set(k, v / all.length);
  return c;
}

/**
 * Tags that describe the cluster: ranked by how many members carry them times their average weight.
 * A tag needs at least two members; when nothing reaches 20 % support the cluster is wallet-driven and the
 * best-supported tags still name it (better "icat-金狗" than "mixed-3").
 */
function topTags(centroid: Tags, members: TokenInfo[]): { tag: string; weight: number }[] {
  const support = new Map<string, number>();
  for (const m of members) for (const k of m.tags.keys()) if (isContentTag(k)) support.set(k, (support.get(k) ?? 0) + 1);
  const ranked = [...support]
    .filter(([, n]) => n >= 2)
    .map(([tag, n]) => ({ tag, support: n, weight: round2((centroid.get(tag) ?? 0) * (n / members.length) * 10) / 10 || 0.01, score: n * (centroid.get(tag) ?? 0) }))
    .sort((a, b) => b.score - a.score);
  const strong = ranked.filter((t) => t.support >= Math.max(2, Math.ceil(members.length * 0.2)));
  return (strong.length ? strong : ranked).slice(0, 6).map(({ tag, weight }) => ({ tag, weight }));
}

export function slugOf(top: { tag: string }[], fallbackId: number): string {
  const clean = (s: string) => s.replace(/[^a-z0-9一-鿿]/g, "").slice(0, 14);
  const parts = top.slice(0, 2).map((t) => clean(t.tag)).filter(Boolean);
  if (!parts.length) return `mixed-${fallbackId}`;
  return parts.join("-");
}

/** Keep slugs stable across ticks: a cluster that shares ≥ 50 % of members with a previous one inherits its slug. */
export function inheritSlugs(prev: { slug: string; members: string[] }[], curr: RawCluster[]): RawCluster[] {
  const used = new Set<string>();
  for (const c of curr) {
    const mine = new Set(c.members);
    let best: { slug: string; score: number } | null = null;
    for (const p of prev) {
      if (used.has(p.slug) || p.slug.startsWith("mixed-")) continue;
      const shared = p.members.filter((m) => mine.has(m)).length;
      const score = shared / Math.min(mine.size, p.members.length);
      if (score >= 0.5 && (!best || score > best.score)) best = { slug: p.slug, score };
    }
    if (best) { c.slug = best.slug; used.add(best.slug); }
  }
  // de-duplicate freshly generated slugs
  const seen = new Map<string, number>();
  for (const c of curr) {
    if (used.has(c.slug) && seen.get(c.slug) === undefined) { seen.set(c.slug, 1); continue; }
    const n = seen.get(c.slug) ?? 0;
    if (n) c.slug = `${c.slug}-${n + 1}`;
    seen.set(c.slug.replace(/-\d+$/, ""), n + 1);
  }
  return curr;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
