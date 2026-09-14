/**
 * Readings: one to three sentences on top of every answer, built only from the numbers underneath.
 * They exist so a person (or a chat) gets the point before the table, and so the bot, the CLI and the site say the same thing.
 */
import type { NowOut, WhyOut, FlowOut, WalletsOut } from "../schemas.js";
import type { TrendOut, ClusterHistoryRow, TokenHourRow } from "./trend.js";
import type { FlowHistoryOut } from "./flowHistory.js";

const eth = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const n = (v: number) => v.toLocaleString("en-US");

export function readBoard(r: Pick<NowOut, "clusters" | "counts" | "window">): string {
  const cl = r.clusters.filter((k) => k.status !== "DEAD");
  if (!cl.length) return `No live meta in the last ${r.window}: ${n(r.counts.launches)} launches, none of them clustering.`;
  const total = cl.reduce((s, k) => s + k.heat.quote_norm_in, 0);
  const hot = [...cl].sort((a, b) => b.heat.quote_norm_in - a.heat.quote_norm_in)[0];
  const live = cl.filter((k) => k.status === "HOT" || k.status === "ROTATING IN").length;
  const drain = [...cl].sort((a, b) => b.flow.out_wallets - a.flow.out_wallets)[0];
  const byNar = new Map<string, number>(); for (const k of cl) byNar.set(k.narrative, (byNar.get(k.narrative) ?? 0) + k.heat.quote_norm_in);
  const topNar = [...byNar].sort((a, b) => b[1] - a[1])[0];
  const parts = [`${live ? `${live} meta${live === 1 ? "" : "s"} live` : "Nothing HOT"} out of ${cl.length}; ${eth(total)} ETH went in over the last ${r.window}.`];
  parts.push(`Most of it into ${hot.slug} (${hot.narrative}, ${eth(hot.heat.quote_norm_in)} ETH, ${n(hot.heat.unique_buyers)} buyers${hot.rotating_from ? `, fed by ${hot.rotating_from}` : ""}).`);
  if (drain && drain.flow.out_wallets >= 8) parts.push(`Capital is leaving ${drain.slug}: ${drain.flow.out_wallets} wallets moved to ${cl.filter((k) => k.rotating_from === drain.slug).length} other metas.`);
  if (topNar && topNar[0] !== "mixed") parts.push(`${topNar[0]} holds ${Math.round((topNar[1] / (total || 1)) * 100)}% of the ETH.`);
  return parts.join(" ");
}

export function readWhy(r: WhyOut): string {
  const k = r.cluster, h = k.heat, l = k.links;
  const glue = [["shared names", l.text], ["meaning", l.semantic], ["shared buyers", l.wallet], ["one deployer", l.deployer]].filter(([, v]) => (v as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number));
  const parts = [`${k.slug} is ${k.status.toLowerCase()}: ${h.n_launches} launches in the window, ${h.n_alive} of ${k.n_members} members still trading, ${eth(h.quote_norm_in)} ETH from ${n(h.unique_buyers)} buyers${h.n_graduated ? `, ${h.n_graduated} graduated` : ""}.`];
  if (glue.length) parts.push(`Held together mostly by ${glue[0][0]} (${glue[0][1]} links${glue[1] ? `, then ${glue[1][0]} with ${glue[1][1]}` : ""}).`);
  if (h.delta_pct !== null) parts.push(`ETH in is ${h.delta_pct >= 0 ? "up" : "down"} ${Math.abs(h.delta_pct)}% against the previous window.`);
  if (r.edges_in[0]) parts.push(`${r.edges_in[0].wallets} wallets arrived from ${r.edges_in[0].from}.`);
  if (r.edges_out[0]) parts.push(`${r.edges_out[0].wallets} wallets already left for ${r.edges_out[0].to}.`);
  if (h.graduated_share >= 0.3) parts.push(`${Math.round(h.graduated_share * 100)}% of members are in pools already: a mature wave.`);
  return parts.join(" ");
}

export function readFlow(r: Pick<FlowOut, "edges" | "nodes" | "window">): string {
  if (!r.edges.length) return `No rotation above the threshold in the last ${r.window}: repeat buyers stayed where they were.`;
  const top = r.edges[0];
  const bySource = new Map<string, number>(); for (const e of r.edges) bySource.set(e.from, (bySource.get(e.from) ?? 0) + e.wallets);
  const byDest = new Map<string, number>(); for (const e of r.edges) byDest.set(e.to, (byDest.get(e.to) ?? 0) + e.wallets);
  const src = [...bySource].sort((a, b) => b[1] - a[1])[0], dst = [...byDest].sort((a, b) => b[1] - a[1])[0];
  const parts = [`Biggest move: ${top.wallets} wallets from ${top.from} to ${top.to} with ${eth(top.quote_norm)} ETH.`];
  if (src) parts.push(`${src[0]} is the main source (${src[1]} wallets out across ${r.edges.filter((e) => e.from === src[0]).length} metas)`);
  if (dst) parts[parts.length - 1] += `${src ? "; " : ""}${dst[0]} is the main destination (${dst[1]} wallets in).`;
  return parts.join(" ");
}

export function readTrend(t: TrendOut): string {
  const rows = t.rows.filter((r) => r.eth > 0);
  if (!rows.length) return `No ETH recorded in the last ${t.hours}h.`;
  const peak = [...rows].sort((a, b) => b.eth - a.eth)[0];
  const last = rows[rows.length - 1];
  const parts = [`Peak ${eth(peak.eth)} ETH in the ${t.step}h block starting ${peak.from.slice(5, 16).replace("T", " ")} UTC; the latest block did ${eth(last.eth)} ETH.`];
  for (const nar of t.narratives.filter((x) => x !== "mixed").slice(0, 2)) {
    const series = rows.map((r) => r.narratives[nar] ?? 0);
    const max = Math.max(...series), at = rows[series.indexOf(max)];
    if (max >= 25) parts.push(`${nar} peaked at ${max}% of ETH (${at.from.slice(5, 16).replace("T", " ")}) and is at ${series[series.length - 1]}% now.`);
  }
  return parts.join(" ");
}

export function readWallets(r: Pick<WalletsOut, "wallets" | "counts" | "cohort" | "window">): string {
  const c = r.counts;
  const parts = [`${n(c.wallets)} wallets bought in the last ${r.window}: ${c.sniper} snipers, ${c.rotator} rotators, ${c["early-in-hot"]} early-in-hot, ${c.sprayer} sprayer bots.`];
  const top = r.wallets[0];
  if (top) parts.push(`Top${r.cohort ? " " + r.cohort : ""} by net flow: ${top.wallet.slice(0, 8)}… ${top.net_eth >= 0 ? "+" : ""}${eth(top.net_eth)} ETH across ${top.tokens} tokens and ${top.clusters.length} metas, median entry ${top.median_entry_sec ?? "?"}s after launch.`);
  return parts.join(" ");
}

export function readClusterHistory(slug: string, rows: ClusterHistoryRow[], hours: number): string {
  if (!rows.length) return `No snapshots of ${slug} in the last ${hours}h.`;
  const byStatus = new Map<string, number>(); for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const top = [...byStatus].sort((a, b) => b[1] - a[1])[0];
  const peak = [...rows].sort((a, b) => b.quote_eth - a.quote_eth)[0];
  const first = rows[0], last = rows[rows.length - 1];
  return `${slug} was ${top[0].toLowerCase()} in ${Math.round((top[1] / rows.length) * 100)}% of ${rows.length} snapshots over ${hours}h, peaking at ${eth(peak.quote_eth)} ETH (${peak.ts.slice(11, 16)} UTC); it went from ${first.status.toLowerCase()} to ${last.status.toLowerCase()}.`;
}

export function readTokenHistory(token: string, rows: TokenHourRow[], hours: number): string {
  if (!rows.length) return `No trades of ${token.slice(0, 10)}… in the last ${hours}h.`;
  const totalIn = rows.reduce((s, r) => s + r.curve_in_eth + r.pool_in_eth, 0);
  const peak = [...rows].sort((a, b) => b.curve_in_eth + b.pool_in_eth - a.curve_in_eth - a.pool_in_eth)[0];
  const active = rows.filter((r) => r.curve_buys + r.pool_buys > 0).length;
  return `${eth(totalIn)} ETH in over ${hours}h, active in ${active} of ${rows.length} hours, busiest hour ${peak.hour.slice(11, 16)} UTC with ${eth(peak.curve_in_eth + peak.pool_in_eth)} ETH and ${peak.buyers} buyers.`;
}

export function readFlowHistory(h: FlowHistoryOut): string {
  const filled = h.slots.filter((s) => s.ts !== null);
  if (!filled.length) return `No ticks in the last ${h.hours}h: the cache has no snapshots for the ${h.window} window yet.`;
  const withEdges = filled.filter((s) => s.edges.length);
  if (!withEdges.length) return `${filled.length} of ${h.slots.length} steps sampled over the last ${h.hours}h; no rotation above the threshold in any of them.`;
  const busiest = withEdges.reduce((b, s) => (s.edges.reduce((n, e) => n + e.wallets, 0) > b.edges.reduce((n, e) => n + e.wallets, 0) ? s : b));
  const moved = busiest.edges.reduce((n, e) => n + e.wallets, 0);
  const dest = new Map<string, number>(); for (const s of withEdges) for (const e of s.edges) dest.set(e.to, (dest.get(e.to) ?? 0) + 1);
  const top = [...dest].sort((a, b) => b[1] - a[1])[0];
  const when = new Date((busiest.ts as number) * 1000).toISOString().slice(11, 16);
  return `${withEdges.length} of ${h.slots.length} steps show rotation over the last ${h.hours}h. Busiest sample at ${when} UTC: ${moved} wallets across ${busiest.edges.length} edges, led by ${busiest.edges[0].from} → ${busiest.edges[0].to}. ${top[0]} is the most frequent destination (${top[1]} of ${withEdges.length} samples).`;
}
