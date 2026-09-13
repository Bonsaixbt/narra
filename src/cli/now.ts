import type { Args } from "./args.js";
import { open, printJson } from "./common.js";
import { c, eth, table, utc, STATUS_COLOR, short, ago } from "./render.js";
import type { NowOut } from "../schemas.js";

export function renderNow(r: NowOut, members: boolean): string {
  const lines: string[] = [];
  lines.push(`${c.bold("NARRA")}  ${utc()}   window ${r.window}   pair ${c.dim("all")}   head ${r.head_block ?? "?"}${r.lag_blocks !== null ? `   lag ${r.lag_blocks}` : ""}   ${c.dim(r.source.rpc + " · " + r.source.mode)}`);
  lines.push("");
  if (!r.clusters.length) {
    lines.push(c.dim(`no live meta right now — ${r.counts.launches} launches and ${r.counts.trades} trades in the window, none clustered`));
    return lines.join("\n");
  }
  const rows = r.clusters.map((k) => {
    const h = k.heat;
    const rot = k.rotating_from ? c.dim(`← ${k.rotating_from}`) : k.rotating_to ? c.dim(`→ ${k.rotating_to}`) : "";
    return [STATUS_COLOR[k.status]?.(k.status.padEnd(12)) ?? k.status, k.slug, `${h.n_launches} CA`, `${eth(h.quote_norm_in)} ETH`, `${h.n_graduated} grad`, `${Math.round(h.graduated_share * 100)}% pool`, `${h.unique_buyers} buyers`, rot];
  });
  lines.push(table(rows, [12, 22, 7, 10, 7, 9, 11, 0]));
  if (members) {
    for (const k of r.clusters) {
      if (!k.members?.length) continue;
      lines.push("", `${c.bold(k.slug)}  ${STATUS_COLOR[k.status]?.(k.status) ?? k.status}  tags ${k.top_tags.map((t) => `${t.tag} ${t.weight}`).join("  ")}`);
      const mrows = k.members.slice(0, 12).map((m) => [`  ${short(m.token)}`, m.symbol ? `$${m.symbol}`.slice(0, 14) : c.dim("(no symbol)"), m.phase, m.membership.toFixed(2), `${m.buyers_overlap} overlap`, m.last_trade_ts ? c.dim(ago(m.last_trade_ts)) : c.dim("no trades")]);
      lines.push(table(mrows, [14, 15, 6, 5, 11, 0]));
    }
  }
  lines.push("", c.dim(`${r.counts.clustered}/${r.counts.candidates} tokens clustered · ${r.counts.launches} launches · ${r.counts.trades} trades · ${r.counts.sprayers} sprayer wallets ignored · narra why <slug> · narra coin <CA>`));
  return lines.join("\n");
}

export async function now(args: Args): Promise<number> {
  const { n, q, done } = open(args);
  try {
    const r = await n.now({ ...q, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (args.flags.json) printJson(r); else console.log(renderNow(r, q.members ?? false));
    return 0;
  } finally { n.close(); }
}
