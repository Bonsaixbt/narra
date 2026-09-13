/**
 * Threshold calibration from the snapshots the cache has accumulated. Every tick stores each published cluster's heat;
 * this reads them back, prints the distribution, and proposes thresholds such that roughly `--hot-share` of published
 * clusters would be HOT at any moment. `--write` stores the proposal in thresholds.json with the calibration date.
 * The proposal is a suggestion printed with its evidence; the defaults stay until someone writes them on purpose.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table } from "./render.js";
import type { Heat } from "../analyze/types.js";

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function calibrate(args: Args): Promise<number> {
  const hours = Number(str(args.flags.hours) ?? 168);
  const hotShare = Number(str(args.flags["hot-share"]) ?? 0.1);
  const window = str(args.flags.window) ?? "60m";
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const rows = n.store.db.prepare(`SELECT slug, ts, status, payload FROM cluster_snapshots WHERE window = ? AND ts >= ?`).all(window, since) as { slug: string; ts: number; status: string; payload: string }[];
    if (rows.length < 20) { console.error(`only ${rows.length} snapshots for window ${window} in the last ${hours}h; run narra watch or serve for a while first`); return 3; }
    const heats = rows.map((r) => (JSON.parse(r.payload) as { heat: Heat }).heat).filter(Boolean);
    const launches = heats.map((h) => h.n_launches), quote = heats.map((h) => h.quote_norm_in), buyers = heats.map((h) => h.unique_buyers), grads = heats.map((h) => h.n_graduated);
    const ticks = new Set(rows.map((r) => r.ts)).size;
    const statusCount: Record<string, number> = {};
    for (const r of rows) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
    // HOT needs all three; pick each at the (1 - hotShare) quantile so the joint share lands at or below the target.
    const pHot = 1 - hotShare;
    const proposal = {
      hot: { min_launches: Math.max(3, Math.round(q(launches, pHot))), min_quote_eth: r2(Math.max(0.2, q(quote, pHot))), min_graduations: q(grads, pHot) >= 1 ? 1 : 0 },
      emerging: { max_launches: Math.max(3, Math.round(q(launches, pHot))), min_delta_pct: 100, min_buyers: Math.max(10, Math.round(q(buyers, 0.5))) },
      cooling: { min_launches: Math.max(3, Math.round(q(launches, 0.5))), max_quote_eth: r2(Math.max(0.05, q(quote, 0.25))), max_delta_pct: -50 },
      quiet: { min_quote_eth: r2(Math.max(0.02, q(quote, 0.25))) },
      publish: { min_buyers: Math.max(5, Math.round(q(buyers, 0.1))), min_launches: 3 },
    };
    const hotNow = heats.filter((h) => h.n_launches >= proposal.hot.min_launches && h.quote_norm_in >= proposal.hot.min_quote_eth && h.n_graduated >= proposal.hot.min_graduations).length / heats.length;
    const out = { window, hours, snapshots: rows.length, ticks, clusters: new Set(rows.map((r) => r.slug)).size, status_share: Object.fromEntries(Object.entries(statusCount).map(([k, v]) => [k, r2(v / rows.length)])),
      quantiles: { launches: [0.25, 0.5, 0.75, 0.9, 0.95].map((p) => [p, q(launches, p)]), quote_eth: [0.25, 0.5, 0.75, 0.9, 0.95].map((p) => [p, r2(q(quote, p))]), buyers: [0.25, 0.5, 0.75, 0.9, 0.95].map((p) => [p, q(buyers, p)]) },
      proposal, projected_hot_share: r2(hotNow) };
    if (args.flags.json) printJson(out);
    else {
      console.log(`${c.bold("narra calibrate")}  window ${window}  ${rows.length} snapshots over ${ticks} ticks, ${out.clusters} clusters, last ${hours}h`);
      console.log(c.dim(`current status share: ${Object.entries(out.status_share).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(" · ")}`));
      console.log("", table([["quantile", "launches", "ETH in", "buyers"], ...[0.25, 0.5, 0.75, 0.9, 0.95].map((p, i) => [`p${Math.round(p * 100)}`, String(out.quantiles.launches[i][1]), String(out.quantiles.quote_eth[i][1]), String(out.quantiles.buyers[i][1])])], [10, 10, 10, 0]));
      console.log("\nproposal (target HOT share " + Math.round(hotShare * 100) + "%, projected " + Math.round(hotNow * 100) + "%):");
      console.log(JSON.stringify(proposal, null, 2));
    }
    if (args.flags.write) {
      const p = join(dirname(fileURLToPath(import.meta.url)), "..", "analyze", "thresholds.json");
      const cur = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      writeFileSync(p, JSON.stringify({ ...cur, ...proposal, calibrated_on: new Date().toISOString().slice(0, 10), calibration: { window, hours, snapshots: rows.length, hot_share_target: hotShare } }, null, 2) + "\n");
      console.error(c.green(`written to ${p}`));
    }
    return 0;
  } finally { n.close(); }
}
