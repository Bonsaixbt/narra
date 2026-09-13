/**
 * Trend: what the collected history says. Per hour, ETH into curves and pools split by narrative, launches,
 * buyers. Reads raw rows inside retention and hourly aggregates beyond it, so it works over days.
 */
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, utc } from "./render.js";
import { computeTrend } from "../analyze/trend.js";

export async function trend(args: Args): Promise<number> {
  const hours = Math.max(1, Number(str(args.flags.hours) ?? 48));
  const step = Math.max(1, Number(str(args.flags.step) ?? (hours > 24 ? 4 : 1)));
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    const { since, narratives: topNar, rows: out } = computeTrend(n.store, hours, step);
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
