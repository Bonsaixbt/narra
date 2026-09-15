/** History from the cache: cluster status timeline from snapshots, or a token's hourly curve+pool activity. */
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, STATUS_COLOR, utc } from "./render.js";
import { clusterHistory, tokenHistory } from "../analyze/trend.js";
import { flowHistory, FLOW_STEPS, type FlowStep } from "../analyze/flowHistory.js";
import { readClusterHistory, readTokenHistory, readFlowHistory } from "../analyze/readings.js";
import { WINDOWS, type WindowKey } from "./args.js";

export async function history(args: Args): Promise<number> {
  const target = args.pos[0];
  if (!target) { console.error("usage: narra history <cluster-slug | 0xTOKEN | flow> [--hours 24] [--step 15m|1h|4h] [--window 60m]"); return 10; }
  const hours = Number(str(args.flags.hours) ?? 24);
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    if (target === "flow") {
      const step = (str(args.flags.step) ?? "1h") as FlowStep;
      const window = (str(args.flags.window) ?? "60m") as WindowKey;
      if (!(step in FLOW_STEPS)) { console.error("--step must be 15m, 1h or 4h"); return 10; }
      if (!(window in WINDOWS)) { console.error("--window must be 15m, 60m or 4h"); return 10; }
      const h = flowHistory(n.store, window, hours, step, n.store.stats().newest_trade_ts ?? Math.floor(Date.now() / 1000));
      const reading = readFlowHistory(h);
      if (args.flags.json) { printJson({ ...h, reading }); return 0; }
      console.log(`${c.bold("flow history")}  ${window} window · last ${hours}h in ${step} steps  ${utc()}\n\n  ${reading}\n`);
      const rows = h.slots.map((s) => {
        const moved = s.edges.reduce((x, e) => x + e.wallets, 0);
        const top = s.edges[0];
        return [new Date(s.from_ts * 1000).toISOString().slice(5, 16), s.ts === null ? "—" : String(s.nodes.length), s.ts === null ? "—" : String(s.edges.length), s.ts === null ? "—" : String(moved), top ? `${top.from} → ${top.to} (${top.wallets})` : ""];
      });
      console.log(table([["step from", "metas", "edges", "wallets moved", "biggest edge"], ...rows], [12, 6, 6, 14, 44]));
      if (h.backfilled) console.log(`\n  ${h.backfilled} ticks recomputed from stored trades and saved for next time.`);
      return 0;
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(target)) {
      const token = target.toLowerCase();
      const out = tokenHistory(n.store, token, hours);
      const reading = readTokenHistory(token, out, hours);
      if (args.flags.json) { printJson({ token, hours, rows: out, reading }); return 0; }
      console.log(`${c.bold(token)}  last ${hours}h  ${utc()}\n\n  ${reading}\n`);
      console.log(table([["hour", "curve buys", "curve ETH", "pool buys", "pool ETH", "buyers"], ...out.map((r) => [r.hour.slice(5, 16), String(r.curve_buys), r.curve_in_eth.toFixed(2), String(r.pool_buys), r.pool_in_eth.toFixed(2), String(r.buyers)])], [17, 11, 10, 10, 9, 0]));
      return 0;
    }
    const window = (str(args.flags.window) ?? "60m") as WindowKey;
    if (!(window in WINDOWS)) { console.error("--window must be 15m, 60m or 4h"); return 10; }
    const out = clusterHistory(n.store, target, hours, undefined, window);
    if (!out.length) { console.error(`no snapshots for "${target}" in the last ${hours}h`); return 3; }
    const reading = readClusterHistory(target, out, hours);
    if (args.flags.json) { printJson({ slug: target, window, hours, snapshots: out, reading }); return 0; }
    console.log(`${c.bold(target)}  last ${hours}h  ${out.length} snapshots  ${utc()}\n\n  ${reading}\n`);
    // one line per status change plus the last row
    const lines: string[][] = [];
    let prev = "";
    out.forEach((r, i) => { if (r.status !== prev || i === out.length - 1) { lines.push([r.ts.slice(5, 16), r.window, STATUS_COLOR[r.status]?.(r.status.padEnd(12)) ?? r.status, `${r.n_launches} CA`, `${r.quote_eth.toFixed(2)} ETH`, `${r.buyers} buyers`, `${r.members} members`]); prev = r.status; } });
    console.log(table(lines, [17, 5, 13, 7, 11, 12, 0]));
    return 0;
  } finally { n.close(); }
}
const round = (x: number) => Math.round(x * 1000) / 1000;
