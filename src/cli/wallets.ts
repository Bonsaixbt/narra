import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, utc, short, ago, STATUS_COLOR } from "./render.js";
import type { WalletsOut, WalletOut } from "../schemas.js";

const COHORTS = ["sniper", "sprayer", "rotator", "early-in-hot"] as const;

export function renderWallets(r: WalletsOut): string {
  const L = [`${c.bold("NARRA wallets")}  ${utc()}   window ${r.window}   ${r.cohort ? "cohort " + r.cohort : "all cohorts"}   sort ${r.sort}`,
    c.dim(`${r.counts.wallets} wallets · ${r.counts.sniper} snipers · ${r.counts.sprayer} sprayers · ${r.counts.rotator} rotators · ${r.counts["early-in-hot"]} early-in-hot`), ""];
  const rows = r.wallets.map((w) => [short(w.wallet, 8), `${w.buys}/${w.sells}`, String(w.tokens), w.quote_in.toFixed(2), w.quote_out.toFixed(2), (w.net_eth >= 0 ? c.green : c.red)(w.net_eth.toFixed(2).padStart(7)), `${w.wins}/${w.closed_tokens}`, w.median_entry_sec === null ? "-" : `${w.median_entry_sec}s`, `${Math.round(w.fast_share * 100)}%`, w.cohorts.join(",") || c.dim("-"), c.dim(w.clusters.slice(0, 3).join(" "))]);
  L.push(table([["wallet", "buy/sell", "tok", "in ETH", "out ETH", "net", "wins", "entry", "fast", "cohorts", "clusters"], ...rows], [16, 9, 4, 8, 8, 8, 6, 7, 6, 22, 0]));
  L.push("", c.dim("net = out − in over the window; ignores what is still held. Cohorts are arithmetic labels, not a signal."));
  return L.join("\n");
}

export function renderWallet(r: WalletOut): string {
  const L = [`${c.bold(r.wallet)}  ${utc()}   window ${r.window}`];
  const s = r.stat;
  if (s) L.push(c.dim(`${s.buys} buys · ${s.sells} sells · ${s.tokens} tokens · in ${s.quote_in} ETH · out ${s.quote_out} ETH · net ${s.net_eth} · wins ${s.wins}/${s.closed_tokens} · median entry ${s.median_entry_sec ?? "-"}s · fast ${Math.round(s.fast_share * 100)}% · cohorts ${s.cohorts.join(", ") || "-"}`));
  else L.push(c.dim("no activity inside the window; positions below come from the wider cache"));
  L.push("", "positions");
  const rows = r.positions.slice(0, 40).map((p) => [`  ${short(p.token)}`, p.symbol ? `$${p.symbol}`.slice(0, 14) : c.dim("(no symbol)"), p.venue, `${p.buys}/${p.sells}`, p.quote_in.toFixed(3), p.quote_out.toFixed(3), p.first_buy_after_launch_sec === null ? "-" : `+${p.first_buy_after_launch_sec}s`, p.cluster ? `${p.cluster} ${STATUS_COLOR[p.status ?? ""]?.(p.status ?? "") ?? ""}` : c.dim("-"), c.dim(ago(p.last_ts))]);
  L.push(table([["", "token", "venue", "b/s", "in", "out", "entry", "cluster", "last"], ...rows], [14, 15, 6, 6, 7, 7, 8, 28, 0]));
  L.push("", c.dim(r.note));
  return L.join("\n");
}

export async function wallets(args: Args): Promise<number> {
  const cohort = str(args.flags.cohort) as (typeof COHORTS)[number] | undefined;
  if (cohort && !COHORTS.includes(cohort)) { console.error(`unknown cohort "${cohort}" (${COHORTS.join(", ")})`); return 10; }
  const sort = (str(args.flags.sort) ?? "net_eth") as "net_eth" | "tokens" | "buys" | "quote_in";
  const { n, q, done } = open(args);
  try {
    const r = await n.wallets({ ...q, cohort, sort, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (args.flags.json) printJson(r); else console.log(renderWallets(r));
    return 0;
  } finally { n.close(); }
}

export async function wallet(args: Args): Promise<number> {
  const addr = args.pos[0];
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) { console.error("usage: narra wallet <0xADDRESS>"); return 10; }
  const { n, q, done } = open(args);
  try {
    const r = await n.wallet(addr, { ...q, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (args.flags.json) printJson(r); else console.log(renderWallet(r));
    return 0;
  } finally { n.close(); }
}
