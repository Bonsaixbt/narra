/**
 * Tokens → clusters. Two tokens are linked when their tags are close, or they share buyers, or they share a deployer
 * and at least one content tag. Connected components of that graph are the metas.
 */
import { similarity, isContentTag, type Tags } from "./tokenize.js";
import type { TokenInfo } from "./types.js";

export interface ClusterOptions {
  /** A content tag needs this many tokens in the window before it can link anything. */
  minTagSupport: number;
  /** Weighted Jaccard at or above this links two tokens. */
  simThreshold: number;
  /** Shared buyers at or above this links two tokens regardless of names. */
  minBuyerOverlap: number;
  /** Components smaller than this are not published. */
  minSize: number;
  /** Wallets that bought more than this many tokens are bots/routers and do not vote. */
  maxTokensPerWallet: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { minTagSupport: 3, simThreshold: 0.35, minBuyerOverlap: 5, minSize: 3, maxTokensPerWallet: 60 };

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

export function buildClusters(tokens: TokenInfo[], buyers: Map<string, Set<string>>, opts: ClusterOptions = DEFAULT_CLUSTER_OPTIONS): RawCluster[] {
  const idx = new Map(tokens.map((t, i) => [t.token, i]));
  const uf = new UnionFind(tokens.length);
  const degree = new Map<string, number>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    uf.union(a, b);
    degree.set(tokens[a].token, (degree.get(tokens[a].token) ?? 0) + 1);
    degree.set(tokens[b].token, (degree.get(tokens[b].token) ?? 0) + 1);
  };
  const linked = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // 1. text: inverted index on content tags with enough support
  const byTag = new Map<string, number[]>();
  tokens.forEach((t, i) => { for (const tag of t.tags.keys()) if (isContentTag(tag)) { let l = byTag.get(tag); if (!l) { l = []; byTag.set(tag, l); } l.push(i); } });
  for (const [, list] of byTag) {
    if (list.length < opts.minTagSupport || list.length > 400) continue;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const a = list[x], b = list[y], k = key(a, b);
      if (linked.has(k)) continue;
      const ta = tokens[a], tb = tokens[b];
      const sameDeployerAndTag = ta.deployer === tb.deployer;
      if (sameDeployerAndTag || similarity(ta.tags, tb.tags) >= opts.simThreshold) { linked.add(k); link(a, b); }
    }
  }

  // 2. wallets: co-occurrence of buyers across tokens
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
  for (const [k, n] of pairCount) {
    if (n < opts.minBuyerOverlap || linked.has(k)) continue;
    const [a, b] = k.split(":").map(Number);
    linked.add(k); link(a, b);
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
    out.push({ id: id++, members: members.map((m) => m.token), centroid, top_tags: top, slug: slugOf(top, id), membership, degree });
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

function topTags(centroid: Tags, members: TokenInfo[]): { tag: string; weight: number }[] {
  const support = new Map<string, number>();
  for (const m of members) for (const k of m.tags.keys()) support.set(k, (support.get(k) ?? 0) + 1);
  return [...centroid]
    .filter(([k]) => isContentTag(k) && (support.get(k) ?? 0) >= Math.max(2, Math.ceil(members.length * 0.2)))
    .map(([tag, weight]) => ({ tag, weight: round2(weight) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);
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
      if (used.has(p.slug)) continue;
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
