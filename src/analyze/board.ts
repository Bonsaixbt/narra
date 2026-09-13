/** Orchestrates one analysis tick over the store: tokens → clusters → heat → status → edges → snapshots. */
import type { LaunchRow, Store, TokenRow, TradeRow } from "../store/db.js";
import { PHASE } from "../chain/constants.js";
import { tokenize } from "./tokenize.js";
import { buildClusters, buyersByToken, dropSprayers, inheritSlugs, DEFAULT_CLUSTER_OPTIONS, type ClusterOptions } from "./cluster.js";
import { heatOf } from "./heat.js";
import { statusOf, STATUS_ORDER, THRESHOLDS } from "./status.js";
import { flowEdges } from "./flow.js";
import type { ClusterOut, Edge, MemberOut, TokenInfo } from "./types.js";
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
  trades: TradeRow[];
  launches: LaunchRow[];
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

export function analyze(store: Store, windowKey: string, windowSec: number, nowTs: number, opts: ClusterOptions = DEFAULT_CLUSTER_OPTIONS): Analysis {
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
  const sprayerCap = (THRESHOLDS.sprayer_max_tokens as Record<string, number>)[windowKey] ?? 20;
  const { buyers, dropped } = dropSprayers(rawBuyers, sprayerCap);

  const raw = buildClusters([...tokens.values()], buyers, { ...opts, maxTokensPerWallet: sprayerCap });
  const prev = store.latestSnapshots(windowKey).map((s) => ({ slug: s.slug, members: (JSON.parse(s.payload) as { members: string[] }).members ?? [] }));
  inheritSlugs(prev, raw);

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
    return [{ slug: c.slug, label: c.top_tags.map((t) => t.tag).slice(0, 3).join(" · ") || c.slug, status, top_tags: c.top_tags, members: c.members, heat, links: c.links, rotating_from: ein[0]?.from ?? null, rotating_to: eout[0]?.to ?? null }];
  });
  const published = new Set(clusters.map((c) => c.slug));
  for (const [tok, slug] of membership) if (!published.has(slug)) { membership.delete(tok); memberScore.delete(tok); }
  clusters.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.heat.quote_norm_in - a.heat.quote_norm_in || b.heat.n_launches - a.heat.n_launches);

  store.saveSnapshots(clusters.map((c) => ({ slug: c.slug, window: windowKey, ts: to, status: c.status, payload: JSON.stringify({ members: c.members, heat: c.heat, top_tags: c.top_tags }) })));

  return {
    window: { key: windowKey, from, to, sec: windowSec }, clusters, edges, centroids, membership, memberScore, tokens, buyers, trades, launches: allLaunches,
    counts: { candidates: tokens.size, clustered: membership.size, trades: windowTrades.length, launches: launchedInWindow.length, sprayers: dropped },
  };
}

export function membersOf(a: Analysis, c: ClusterOut, store: Store): MemberOut[] {
  const last = new Map<string, number>();
  for (const t of a.trades) if (t.token && t.ts >= a.window.from) last.set(t.token, Math.max(last.get(t.token) ?? 0, t.ts));
  const overlap = (token: string): number => {
    const mine = a.buyers.get(token); if (!mine) return 0;
    let n = 0;
    for (const m of c.members) { if (m === token) continue; const b = a.buyers.get(m); if (!b) continue; for (const w of mine) if (b.has(w)) { n++; break; } }
    return n;
  };
  void store;
  return c.members.map((m) => {
    const t = a.tokens.get(m)!;
    return { token: m, symbol: t.symbol, name: t.name, phase: t.phase, curve_progress: null, membership: a.memberScore.get(m) ?? 0, buyers_overlap: overlap(m), last_trade_ts: last.get(m) ?? null, launched_ts: t.launchedTs };
  }).sort((x, y) => y.membership - x.membership || (y.last_trade_ts ?? 0) - (x.last_trade_ts ?? 0));
}
