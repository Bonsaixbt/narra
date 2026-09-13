import type { Args } from "./args.js";
import { open, printJson } from "./common.js";
import { c, utc, VERDICT_COLOR, STATUS_COLOR, ago } from "./render.js";
import type { CoinOut, NotPonsOut } from "../schemas.js";

export const EXIT: Record<string, number> = { IN: 0, EDGE: 1, OUT: 2, ORPHAN: 3, NOT_PONS: 4, NOISE: 3 };

export function renderCoin(r: CoinOut | NotPonsOut): string {
  if (r.verdict === "NOT_PONS") return `${r.token}\n${VERDICT_COLOR.NOT_PONS("NOT_PONS")}  ${r.reasons.join("; ")}`;
  const L: string[] = [];
  L.push(`${c.bold(r.symbol ? "$" + r.symbol : "(no symbol)")} · ${r.name || c.dim("(no name)")} · ${r.token}`);
  const phase = r.phase === "curve" && r.curve ? `curve ${r.curve.real_quote_eth?.toFixed(2) ?? "?"}/${r.curve.threshold_eth} ${r.pair.symbol}` : r.phase === "pool" && r.pool ? `pool · graduated ${ago(r.pool.graduated_at)} · ${r.pool.volume_eth_window.toFixed(2)} ETH volume in window` : r.phase;
  L.push(c.dim(`phase ${phase} · launched ${ago(r.launched_at)} · pair ${r.pair.symbol}`));
  L.push("");
  const v = VERDICT_COLOR[r.verdict]?.(r.verdict.padEnd(7)) ?? r.verdict;
  if (r.cluster) L.push(`${v} ${c.bold(r.cluster.slug)}   ${r.cluster.membership.toFixed(2)}   (cluster ${STATUS_COLOR[r.cluster.status]?.(r.cluster.status) ?? r.cluster.status})`);
  else L.push(`${v} ${c.dim("no cluster")}`);
  for (const a of r.alternatives) L.push(c.dim(`alt     ${a.slug}   ${a.membership.toFixed(2)}`));
  if (r.popularity && r.popularity.cluster_rank !== null) L.push(`${c.cyan("meta")}    #${r.popularity.cluster_rank} of ${r.popularity.clusters_total} on the board · ${r.popularity.rank_in_cluster ? `token #${r.popularity.rank_in_cluster} of ${r.popularity.cluster_size} inside` : `not among its ${r.popularity.cluster_size} members`} · ${r.popularity.buyers} buyers (more than ${r.popularity.buyers_percentile}% of tokens)`);
  if (r.narratives.length) L.push(c.dim(`narrative ${r.narratives.join(", ")}`));
  L.push("", "reasons");
  for (const s of r.reasons) L.push(`  ${s}`);
  if (r.watch.length) { L.push("watch"); for (const s of r.watch) L.push(`  ${c.yellow(s)}`); }
  L.push("", c.dim(`sources  launch tx ${r.evidence.launch_tx ?? "?"}  block ${r.evidence.launch_block ?? "?"}  early buyers ${r.evidence.early_buyers}  overlap ${r.evidence.overlap_buyers}  computed ${utc()}`));
  L.push(c.dim("IN means membership in a live meta. It is not a recommendation."));
  return L.join("\n");
}

export async function coin(args: Args): Promise<number> {
  let addrs = args.pos;
  if (addrs.includes("-") || !addrs.length) {
    const stdin = await new Promise<string>((res) => { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => res(s)); if (process.stdin.isTTY) res(""); });
    addrs = [...addrs.filter((a) => a !== "-"), ...stdin.split(/\s+/).filter(Boolean)];
  }
  addrs = addrs.map((a) => a.trim());
  if (!addrs.length) { console.error("usage: narra coin <CA> [<CA>…]  (or pipe addresses on stdin)"); return 10; }
  for (const a of addrs) if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { console.error(`not an address: ${a}`); return 10; }
  const { n, q, done } = open(args);
  try {
    let worst = 0;
    let first = true;
    for (const a of addrs) {
      const r = await n.coin(a, { ...q, noSync: q.noSync || !first, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
      first = false;
      worst = Math.max(worst, EXIT[r.verdict] ?? 3);
      if (args.flags.quiet) continue;
      if (args.flags.json || args.flags.jsonl) printJson(r); else { console.log(renderCoin(r)); if (addrs.length > 1) console.log(""); }
    }
    return worst;
  } finally { n.close(); }
}
