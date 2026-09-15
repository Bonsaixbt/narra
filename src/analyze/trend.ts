/** Trend and history over the cache, shared by the CLI and the service. */
import type { Store } from "../store/db.js";
import { tokenize } from "./tokenize.js";
import { narrativeOf } from "./narrative.js";
import type { TokenInfo } from "./types.js";

export interface TrendRow { from: string; from_ts: number; launches: number; buys: number; eth: number; narratives: Record<string, number> }
export interface TrendOut { hours: number; step: number; since: number; narratives: string[]; rows: TrendRow[] }

export function computeTrend(store: Store, hours: number, step: number, nowTs = store.stats().newest_trade_ts ?? Math.floor(Date.now() / 1000)): TrendOut {
  const since = nowTs - hours * 3600;
  // INDEXED BY: left alone, the planner walks the (token, ts) index in token order to skip the GROUP BY sort and
  // touches the whole table through random pages (65 s on 2.4M rows); a range on the ts index and a sort take 5 s.
  const rows = store.db.prepare(`
    SELECT token, (ts / 3600) * 3600 AS h, SUM(CASE WHEN side = 'buy' THEN COALESCE(quote_norm, 0) END) AS q, SUM(side = 'buy') AS b FROM curve_trades INDEXED BY trades_ts WHERE ts >= ? AND token IS NOT NULL GROUP BY token, h
    UNION ALL SELECT token, (ts / 3600) * 3600, SUM(CASE WHEN side = 'buy' THEN COALESCE(quote_norm, 0) END), SUM(side = 'buy') FROM pool_swaps INDEXED BY swaps_ts WHERE ts >= ? GROUP BY token, (ts / 3600) * 3600
    UNION ALL SELECT token, hour_ts, quote_in, buys FROM hourly WHERE hour_ts >= ? AND hour_ts + 3600 <= (SELECT COALESCE(MIN(ts), 0) FROM curve_trades)`).all(since, since, since) as { token: string; h: number; q: number; b: number }[];
  const launches = store.db.prepare(`SELECT token, ts FROM launches WHERE ts >= ?`).all(since) as { token: string; ts: number }[];
  const tokens = [...new Set([...rows.map((r) => r.token), ...launches.map((l) => l.token)])];
  const meta = store.tokensFor(tokens);
  const pairs = store.pairs();
  const launchRows = new Map(store.launchesFor(tokens).map((l) => [l.token, l]));
  const narOf = new Map<string, string>();
  for (const t of tokens) {
    const m = meta.get(t), l = launchRows.get(t);
    const kind = pairs.get(l?.pair ?? "")?.kind ?? "other";
    const info: TokenInfo = { token: t, symbol: m?.symbol ?? "", name: m?.name ?? "", description: m?.description ?? "", pair: l?.pair ?? "", pairKind: kind, pairSymbol: "", deployer: l?.deployer ?? "", launchedTs: l?.ts ?? 0, phase: "curve", graduatedTs: null, tags: tokenize({ name: m?.name, symbol: m?.symbol, description: m?.description, pairKind: kind }) };
    narOf.set(t, narrativeOf([info]).narrative);
  }
  const bucketOf = (ts: number) => Math.floor((ts - since) / (step * 3600));
  const nb = Math.ceil(hours / step);
  const buckets = Array.from({ length: nb }, () => ({ eth: 0, buys: 0, launches: 0, byNar: new Map<string, number>() }));
  for (const r of rows) { const i = bucketOf(r.h); if (i < 0 || i >= nb) continue; const b = buckets[i]; b.eth += r.q ?? 0; b.buys += r.b ?? 0; const k = narOf.get(r.token) ?? "mixed"; b.byNar.set(k, (b.byNar.get(k) ?? 0) + (r.q ?? 0)); }
  for (const l of launches) { const i = bucketOf(l.ts); if (i >= 0 && i < nb) buckets[i].launches++; }
  const allNar = new Map<string, number>();
  for (const b of buckets) for (const [k, v] of b.byNar) allNar.set(k, (allNar.get(k) ?? 0) + v);
  const topNar = [...allNar].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k]) => k);
  const out = buckets.map((b, i) => ({ from: new Date((since + i * step * 3600) * 1000).toISOString(), from_ts: since + i * step * 3600, launches: b.launches, buys: b.buys, eth: Math.round(b.eth * 100) / 100, narratives: Object.fromEntries(topNar.map((k) => [k, Math.round(((b.byNar.get(k) ?? 0) / (b.eth || 1)) * 100)])) }));
  return { hours, step, since, narratives: topNar, rows: out };
}

export interface ClusterHistoryRow { ts: string; ts_unix: number; window: string; status: string; n_launches: number; quote_eth: number; buyers: number; graduations: number; members: number; id?: string | null }
export function clusterHistory(store: Store, slug: string, hours: number, nowTs = Math.floor(Date.now() / 1000), window = "60m"): ClusterHistoryRow[] {
  return store.snapshotHistory(slug, nowTs - hours * 3600, window).map((s) => { const p = JSON.parse(s.payload) as { heat?: { n_launches: number; quote_norm_in: number; unique_buyers: number; n_graduated: number }; members?: string[] }; return { ts: new Date(s.ts * 1000).toISOString(), ts_unix: s.ts, window: s.window, status: s.status, id: s.meta_id ?? null, n_launches: p.heat?.n_launches ?? 0, quote_eth: p.heat?.quote_norm_in ?? 0, buyers: p.heat?.unique_buyers ?? 0, graduations: p.heat?.n_graduated ?? 0, members: p.members?.length ?? 0 }; });
}

export interface TokenHourRow { hour: string; hour_ts: number; curve_buys: number; curve_in_eth: number; pool_buys: number; pool_in_eth: number; buyers: number }
export function tokenHistory(store: Store, token: string, hours: number, nowTs = Math.floor(Date.now() / 1000)): TokenHourRow[] {
  const since = nowTs - hours * 3600;
  const t = token.toLowerCase();
  const byHour = new Map<number, { curve_buys: number; curve_in: number; pool_buys: number; pool_in: number; buyers: Set<string> }>();
  const slot = (ts: number) => { const h = Math.floor(ts / 3600) * 3600; let r = byHour.get(h); if (!r) { r = { curve_buys: 0, curve_in: 0, pool_buys: 0, pool_in: 0, buyers: new Set() }; byHour.set(h, r); } return r; };
  for (const r of store.hourlyFor([t], since)) { const s = slot(r.hour_ts); if (r.venue === "curve") { s.curve_buys += r.buys; s.curve_in += r.quote_in; } else { s.pool_buys += r.buys; s.pool_in += r.quote_in; } }
  for (const tr of store.tradesForToken(t, 100_000)) if (tr.ts >= since && tr.side === "buy") { const s = slot(tr.ts); s.curve_buys++; s.curve_in += tr.quote_norm ?? 0; s.buyers.add(tr.recipient); }
  for (const s of store.swapsForToken(t, since)) if (s.side === "buy") { const x = slot(s.ts); x.pool_buys++; x.pool_in += s.quote_norm ?? 0; x.buyers.add(s.wallet); }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return [...byHour].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({ hour: new Date(h * 1000).toISOString(), hour_ts: h, curve_buys: v.curve_buys, curve_in_eth: r3(v.curve_in), pool_buys: v.pool_buys, pool_in_eth: r3(v.pool_in), buyers: v.buyers.size }));
}
