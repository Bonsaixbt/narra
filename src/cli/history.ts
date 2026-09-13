/** History from the cache: cluster status timeline from snapshots, or a token's hourly curve+pool activity. */
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, STATUS_COLOR, utc } from "./render.js";
import { clusterHistory, tokenHistory } from "../analyze/trend.js";

export async function history(args: Args): Promise<number> {
  const target = args.pos[0];
  if (!target) { console.error("usage: narra history <cluster-slug | 0xTOKEN> [--hours 24]"); return 10; }
  const hours = Number(str(args.flags.hours) ?? 24);
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(target)) {
      const token = target.toLowerCase();
      const out = tokenHistory(n.store, token, hours);
      if (args.flags.json) { printJson({ token, hours, rows: out }); return 0; }
      console.log(`${c.bold(token)}  last ${hours}h  ${utc()}`);
      console.log(table([["hour", "curve buys", "curve ETH", "pool buys", "pool ETH", "buyers"], ...out.map((r) => [r.hour.slice(5, 16), String(r.curve_buys), r.curve_in_eth.toFixed(2), String(r.pool_buys), r.pool_in_eth.toFixed(2), String(r.buyers)])], [17, 11, 10, 10, 9, 0]));
      return 0;
    }
    const out = clusterHistory(n.store, target, hours);
    if (!out.length) { console.error(`no snapshots for "${target}" in the last ${hours}h`); return 3; }
    if (args.flags.json) { printJson({ slug: target, hours, snapshots: out }); return 0; }
    console.log(`${c.bold(target)}  last ${hours}h  ${out.length} snapshots  ${utc()}`);
    // one line per status change plus the last row
    const lines: string[][] = [];
    let prev = "";
    out.forEach((r, i) => { if (r.status !== prev || i === out.length - 1) { lines.push([r.ts.slice(5, 16), r.window, STATUS_COLOR[r.status]?.(r.status.padEnd(12)) ?? r.status, `${r.n_launches} CA`, `${r.quote_eth.toFixed(2)} ETH`, `${r.buyers} buyers`, `${r.members} members`]); prev = r.status; } });
    console.log(table(lines, [17, 5, 13, 7, 11, 12, 0]));
    return 0;
  } finally { n.close(); }
}
const round = (x: number) => Math.round(x * 1000) / 1000;
