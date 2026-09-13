/**
 * Trend: what the collected history says. Per hour, ETH into curves and pools split by narrative, launches,
 * buyers. Reads raw rows inside retention and hourly aggregates beyond it, so it works over days.
 */
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, utc } from "./render.js";
import { tokenize } from "../analyze/tokenize.js";
import { narrativeOf } from "../analyze/narrative.js";
import type { TokenInfo } from "../analyze/types.js";

export async function trend(args: Args): Promise<number> {
  const hours = Math.max(1, Number(str(args.flags.hours) ?? 48));
  const step = Math.max(1, Number(str(args.flags.step) ?? (hours > 24 ? 4 : 1)));
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    const now = n.store.stats().newest_trade_ts ?? Math.floor(Date.now() / 1000);
    const since = now - hours * 3600;
    // per token per hour: quote in (curve + pool), buys, from raw rows and hourly aggregates
    const rows = n.store.db.prepare(`
      SELECT token, (ts / 3600) * 3600 AS h, SUM(CASE WHEN side = 'buy' THEN COALESCE(quote_norm, 0) END) AS q, SUM(side = 'buy') AS b FROM curve_trades WHERE ts >= ? AND token IS NOT NULL GROUP BY token, h
      UNION ALL SELECT token, (ts / 3600) * 3600, SUM(CASE WHEN side = 'buy' THEN COALESCE(quote_norm, 0) END), SUM(side = 'buy') FROM pool_swaps WHERE ts >= ? GROUP BY token, (ts / 3600) * 3600
      UNION ALL SELECT token, hour_ts, quote_in, buys FROM hourly WHERE hour_ts >= ?`).all(since, since, since) as { token: string; h: number; q: number; b: number }[];
    const launches = n.store.db.prepare(`SELECT token, deployer, pair, ts FROM launches WHERE ts >= ?`).all(since) as { token: string; deployer: string; pair: string; ts: number }[];
    const tokens = [...new Set([...rows.map((r) => r.token), ...launches.map((l) => l.token)])];
    const meta = n.store.tokensFor(tokens);
    const pairs = n.store.pairs();
    const launchRows = new Map(n.store.launchesFor(tokens).map((l) => [l.token, l]));
    const infos = new Map<string, TokenInfo>();
    for (const t of tokens) {
      const m = meta.get(t), l = launchRows.get(t);
      const kind = pairs.get(l?.pair ?? "")?.kind ?? "other";
      infos.set(t, { token: t, symbol: m?.symbol ?? "", name: m?.name ?? "", description: m?.description ?? "", pair: l?.pair ?? "", pairKind: kind, pairSymbol: "", deployer: l?.deployer ?? "", launchedTs: l?.ts ?? 0, phase: "curve", graduatedTs: null, tags: tokenize({ name: m?.name, symbol: m?.symbol, description: m?.description, pairKind: kind }) });
    }
    const narOf = new Map<string, string>();
    for (const [t, info] of infos) narOf.set(t, narrativeOf([info]).narrative);
    // buckets of `step` hours
    const bucketOf = (ts: number) => Math.floor((ts - since) / (step * 3600));
    const nb = Math.ceil(hours / step);
    const buckets = Array.from({ length: nb }, () => ({ eth: 0, buys: 0, launches: 0, byNar: new Map<string, number>() }));
    for (const r of rows) { const i = bucketOf(r.h); if (i < 0 || i >= nb) continue; const b = buckets[i]; b.eth += r.q; b.buys += r.b; const k = narOf.get(r.token) ?? "mixed"; b.byNar.set(k, (b.byNar.get(k) ?? 0) + r.q); }
    for (const l of launches) { const i = bucketOf(l.ts); if (i >= 0 && i < nb) buckets[i].launches++; }
    const allNar = new Map<string, number>();
    for (const b of buckets) for (const [k, v] of b.byNar) allNar.set(k, (allNar.get(k) ?? 0) + v);
    const topNar = [...allNar].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k]) => k);
    const out = buckets.map((b, i) => ({ from: new Date((since + i * step * 3600) * 1000).toISOString(), launches: b.launches, buys: b.buys, eth: Math.round(b.eth * 100) / 100, narratives: Object.fromEntries(topNar.map((k) => [k, Math.round(((b.byNar.get(k) ?? 0) / (b.eth || 1)) * 100)])) }));
    if (args.flags.json) { printJson({ hours, step, since, narratives: topNar, rows: out }); return 0; }
    console.log(`${c.bold("NARRA trend")}  ${utc()}   last ${hours}h in ${step}h steps   ${c.dim("ETH into curves and pools, share by narrative")}`);
    const head = ["from (UTC)", "launches", "buys", "ETH in", ...topNar.map((k) => k.slice(0, 10))];
    const maxEth = Math.max(0.001, ...out.map((r) => r.eth));
    const body = out.map((r) => [r.from.slice(5, 16).replace("T", " "), String(r.launches), String(r.buys), r.eth.toFixed(1).padStart(7) + " " + c.red("█".repeat(Math.round((r.eth / maxEth) * 8))), ...topNar.map((k) => { const v = r.narratives[k]; return v >= 40 ? c.bold(`${v}%`) : v ? `${v}%` : c.dim("·"); })]);
    console.log(table([head, ...body], [12, 9, 7, 18, ...topNar.map(() => 10)]));
    console.log(c.dim(`\nnarrative shares are of ETH in the step; rows beyond the raw retention come from hourly aggregates`));
    return 0;
  } finally { n.close(); }
}
