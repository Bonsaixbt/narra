/** Orchestrates one analysis tick over the store: tokens → clusters → heat → status → edges → snapshots. */
import type { LaunchRow, Store, TokenRow, TradeRow } from "../store/db.js";
import { PHASE } from "../chain/constants.js";
import { tokenize } from "./tokenize.js";
import { buildClusters, buyersByToken, dropSprayers, inheritSlugs, nameable, DEFAULT_CLUSTER_OPTIONS, type ClusterOptions, type SemanticPair } from "./cluster.js";
import { heatOf } from "./heat.js";
import { statusOf, STATUS_ORDER, THRESHOLDS } from "./status.js";
import { flowEdges } from "./flow.js";
import type { RawCluster } from "./cluster.js";
import type { ClusterOut, Edge, MemberOut, TokenInfo } from "./types.js";
import { walletStats, clusterStatuses, cohortMix, type WalletStat } from "./wallets.js";
import { narrativeOf } from "./narrative.js";
import type { Tags } from "./tokenize.js";

export interface Analysis {
  window: { key: string; from: number; to: number; sec: number };
  clusters: ClusterOut[];
  edges: Edge[];
  centroids: Map<string, Tags>;
  membership: Map<string, string>;
  memberScore: Map<string, number>;
  tokens: Map<string, TokenInfo>;
  buyers: Map<string, Set<string>>;
  /** buyers in the last 10 minutes of the window, for the rotation signal */
  recentBuyers: Map<string, Set<string>>;
  trades: TradeRow[];
  launches: LaunchRow[];
  wallets: Map<string, WalletStat>;
  sprayerCap: number;
  /** deployer → launches in window */
  deployerFan: Map<string, number>;
  counts: { candidates: number; clustered: number; trades: number; launches: number; sprayers: number };
}

export function toTokenInfo(l: LaunchRow, t: TokenRow | undefined, pairKind: TokenInfo["pairKind"], pairSymbol: string): TokenInfo {
  const info: TokenInfo = {
    token: l.token, symbol: t?.symbol ?? "", name: t?.name ?? "", description: t?.description ?? "",
    pair: l.pair, pairKind, pairSymbol, deployer: l.deployer, launchedTs: l.ts,
    phase: PHASE[l.phase] ?? "curve", graduatedTs: l.graduated_at,
    tags: new Map(),
  };
  info.tags = tokenize({ name: info.name, symbol: info.symbol, description: info.description, pairKind });
  return info;
}

export interface AnalyzeExtras { semantic?: (tokens: TokenInfo[]) => SemanticPair[]; categorize?: (tokens: TokenInfo[]) => void }

export function analyze(store: Store, windowKey: string, windowSec: number, nowTs: number, opts: ClusterOptions = DEFAULT_CLUSTER_OPTIONS, extras: AnalyzeExtras = {}): Analysis {
  const to = nowTs, from = nowTs - windowSec;
  const trades = store.tradesBetween(from - windowSec, to + 1);
  const swaps = store.swapsBetween(from - windowSec, to + 1);
  const pairs = store.pairs();

  // candidates: launched in window, or traded in window
  const activeTokens = new Set<string>();
  for (const t of trades) if (t.token && t.ts >= from) activeTokens.add(t.token);
  for (const s of swaps) if (s.ts >= from) activeTokens.add(s.token);
  const launchedInWindow = store.launchesSince(from);
  for (const l of launchedInWindow) activeTokens.add(l.token);
  const launchRows = new Map(launchedInWindow.map((l) => [l.token, l]));
  const missing = [...activeTokens].filter((t) => !launchRows.has(t));
  for (const l of store.launchesFor(missing)) launchRows.set(l.token, l);
  const tokenRows = store.tokensFor([...launchRows.keys()]);

  const tokens = new Map<string, TokenInfo>();
  for (const l of launchRows.values()) {
    const p = pairs.get(l.pair);
    tokens.set(l.token, toTokenInfo(l, tokenRows.get(l.token), p?.kind ?? "other", p?.symbol ?? "?"));
  }
  const windowTrades = trades.filter((t) => t.ts >= from);
  const rawBuyers = buyersByToken(windowTrades);
  for (const s of swaps) if (s.ts >= from && s.side === "buy") { let b = rawBuyers.get(s.token); if (!b) { b = new Set(); rawBuyers.set(s.token, b); } b.add(s.wallet); }
  const recentBuyers = buyersByToken(windowTrades.filter((t) => t.ts >= to - 600));
  for (const s of swaps) if (s.ts >= to - 600 && s.side === "buy") { let b = recentBuyers.get(s.token); if (!b) { b = new Set(); recentBuyers.set(s.token, b); } b.add(s.wallet); }
  const sprayerCap = (THRESHOLDS.sprayer_max_tokens as Record<string, number>)[windowKey] ?? 20;
  const { buyers, dropped } = dropSprayers(rawBuyers, sprayerCap);

  const deployerFan = new Map<string, number>();
  for (const l of launchedInWindow) deployerFan.set(l.deployer, (deployerFan.get(l.deployer) ?? 0) + 1);
  const tokenList = [...tokens.values()];
  extras.categorize?.(tokenList);
  const semantic = extras.semantic ? extras.semantic(tokenList) : [];
  const raw = buildClusters(tokenList, buyers, { ...opts, maxTokensPerWallet: sprayerCap }, 4, semantic);
  const prev = store.latestSnapshots(windowKey).map((s) => ({ slug: s.slug, members: (JSON.parse(s.payload) as { members: string[] }).members ?? [], meta_id: s.meta_id ?? null, first_seen: s.first_seen ?? null, ts: s.ts }));
  inheritSlugs(prev, raw);
  // identity: an inherited slug keeps the previous tick's id (snapshots from before ids existed get slug@their ts); a fresh slug is a new meta
  const prevBySlug = new Map(prev.map((p) => [p.slug, p]));
  const identity = (c: RawCluster): { id: string; first_seen_ts: number } => {
    // inherited (half the members shared) or the same slug with at least one member in common: the same meta.
    // Without the second rule a slug that regenerates from its tags every tick was born again every tick.
    let p = prevBySlug.get(c.slug);
    if (p && !c.inherited) { const mine = new Set(c.members); if (!p.members.some((m) => mine.has(m))) p = undefined; }
    if (!p) return { id: `${c.slug}@${to}`, first_seen_ts: to };
    const first = p.first_seen ?? p.ts;
    return { id: p.meta_id ?? `${c.slug}@${first}`, first_seen_ts: first };
  };

  const membership = new Map<string, string>();
  const memberScore = new Map<string, number>();
  const centroids = new Map<string, Tags>();
  for (const c of raw) { centroids.set(c.slug, c.centroid); for (const m of c.members) { membership.set(m, c.slug); memberScore.set(m, c.membership.get(m) ?? 0); } }

  const allLaunches = [...launchRows.values()];
  const edges = flowEdges(membership, trades, allLaunches, { from, to });
  const clusters: ClusterOut[] = raw.flatMap((c) => {
    const members = new Set(c.members);
    const heat = heatOf({ members, tokens, trades, swaps, launches: allLaunches, window: { from, to }, aliveWindowSec: THRESHOLDS.alive_window_sec });
    const ein = edges.filter((e) => e.to === c.slug), eout = edges.filter((e) => e.from === c.slug);
    const status = statusOf(heat, ein, eout);
    if (heat.unique_buyers < THRESHOLDS.publish.min_buyers && heat.n_launches < THRESHOLDS.publish.min_launches) return [];
    const nar = narrativeOf(c.members.map((m) => tokens.get(m)!).filter(Boolean));
    const flow = { in_wallets: ein.reduce((s, e) => s + e.wallets, 0), in_eth: r3(ein.reduce((s, e) => s + e.quote_norm, 0)), out_wallets: eout.reduce((s, e) => s + e.wallets, 0), out_eth: r3(eout.reduce((s, e) => s + e.quote_norm, 0)) };
    return [{ slug: c.slug, ...identity(c), label: nameable(c.top_tags).map((t) => t.tag).slice(0, 3).join(" · ") || c.slug, label_source: "tags" as const, status, top_tags: c.top_tags, members: c.members, heat, links: c.links,
      narrative: nar.narrative, narrative_sub: nar.sub, narrative_mix: nar.mix, flow, rank: 0, rotating_from: ein[0]?.from ?? null, rotating_to: eout[0]?.to ?? null }];
  });
  const published = new Set(clusters.map((c) => c.slug));
  // edges name only metas that are on the board: a wallet move into an unpublished cluster is not a node the reader can open
  const publishedEdges = edges.filter((e) => published.has(e.from) && published.has(e.to));
  for (const [tok, slug] of membership) if (!published.has(slug)) { membership.delete(tok); memberScore.delete(tok); }
  // wallet cohorts over the window, then cohort mix per cluster (rawBuyers: sprayers included, they are a cohort too)
  const wallets = walletStats({ trades, swaps, launches: launchRows, membership, statuses: clusterStatuses(clusters), window: { from, to }, sprayerCap });
  for (const c of clusters) {
    const set = new Set<string>();
    for (const m of c.members) for (const w of rawBuyers.get(m) ?? []) set.add(w);
    c.cohorts = cohortMix(set, wallets);
  }
  clusters.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.heat.quote_norm_in - a.heat.quote_norm_in || b.heat.n_launches - a.heat.n_launches);
  clusters.forEach((c, i) => { c.rank = i + 1; });

  store.saveSnapshots(clusters.map((c) => ({ slug: c.slug, window: windowKey, ts: to, status: c.status, payload: JSON.stringify({ members: c.members, heat: c.heat, top_tags: c.top_tags }), meta_id: c.id, first_seen: c.first_seen_ts })));
  // the edges of this tick, for the flow history; only edges between published clusters are kept, like the board shows
  store.saveFlowSnapshot(windowKey, to, publishedEdges);

  return {
    window: { key: windowKey, from, to, sec: windowSec }, clusters, edges: publishedEdges, centroids, membership, memberScore, tokens, buyers, recentBuyers, trades, launches: allLaunches, wallets, sprayerCap, deployerFan,
    counts: { candidates: tokens.size, clustered: membership.size, trades: windowTrades.length, launches: launchedInWindow.length, sprayers: dropped },
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Per token inside the window: last trade and ETH bought — one pass over the trades, shared by every cluster's member list. */
export function lastTradeByToken(a: Analysis): Map<string, { last: number; eth_in: number }> {
  const m = new Map<string, { last: number; eth_in: number }>();
  for (const t of a.trades) {
    if (!t.token || t.ts < a.window.from) continue;
    let r = m.get(t.token); if (!r) { r = { last: 0, eth_in: 0 }; m.set(t.token, r); }
    if (t.ts > r.last) r.last = t.ts;
    if (t.side === "buy") r.eth_in += t.quote_norm ?? 0;
  }
  return m;
}
export function membersOf(a: Analysis, c: ClusterOut, store: Store, last = lastTradeByToken(a)): MemberOut[] {
  const overlap = (token: string): number => {
    const mine = a.buyers.get(token); if (!mine) return 0;
    let n = 0;
    for (const m of c.members) { if (m === token) continue; const b = a.buyers.get(m); if (!b) continue; for (const w of mine) if (b.has(w)) { n++; break; } }
    return n;
  };
  void store;
  return c.members.map((m) => {
    const t = a.tokens.get(m)!;
    const w = last.get(m);
    return { token: m, symbol: t.symbol, name: t.name, phase: t.phase, curve_progress: null, membership: a.memberScore.get(m) ?? 0, buyers_overlap: overlap(m), buyers: a.buyers.get(m)?.size ?? 0, eth_in: Math.round((w?.eth_in ?? 0) * 1000) / 1000, last_trade_ts: w?.last ?? null, launched_ts: t.launchedTs };
  }).sort((x, y) => y.membership - x.membership || (y.last_trade_ts ?? 0) - (x.last_trade_ts ?? 0));
}
