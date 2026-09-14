import type { Args } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, utc, STATUS_COLOR, short, ago, visibleWidth } from "./render.js";
import type { NowOut } from "../schemas.js";

const num = (n: number) => n.toLocaleString("en-US");
const ethf = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));

/** The answer first: what is hot, where capital leaves, which narratives hold the ETH. Then the table. */
export function renderNow(r: NowOut, opts: { members?: boolean; all?: boolean; top?: number; width?: number } = {}): string {
  const W = opts.width ?? process.stdout.columns ?? 120;
  const L: string[] = [];
  const counts: Record<string, number> = {};
  for (const k of r.clusters) counts[k.status] = (counts[k.status] ?? 0) + 1;
  const cl = r.clusters.filter((k) => k.status !== "DEAD"); // totals, hottest, draining and narratives count live metas, like the reading
  const eth = cl.reduce((s, k) => s + k.heat.quote_norm_in, 0);
  const buyers = cl.reduce((s, k) => s + k.heat.unique_buyers, 0);
  L.push(`${c.bold("NARRA")} ${c.dim(utc())}  window ${c.bold(r.window)}  ${c.dim(`head ${r.head_block ?? "?"} · ${r.source.rpc} · ${r.source.mode}`)}`);
  if (!cl.length) {
    L.push("", c.dim(`no live meta right now — ${num(r.counts.launches)} launches and ${num(r.counts.trades)} trades in the window, none clustered`));
    return L.join("\n");
  }
  const order = ["HOT", "ROTATING IN", "EMERGING", "ROTATING OUT", "COOLING", "DEAD"];
  L.push(c.dim(`${r.clusters.length} metas · ${order.filter((s) => counts[s]).map((s) => `${counts[s]} ${STATUS_COLOR[s]?.(s) ?? s}`).join(" · ")} · ${ethf(eth)} ETH · ${num(buyers)} buyers in live metas · ${num(r.counts.launches)} launches`));
  L.push("");
  const hottest = [...cl].sort((a, b) => b.heat.quote_norm_in - a.heat.quote_norm_in)[0];
  const draining = [...cl].sort((a, b) => b.flow.out_wallets - a.flow.out_wallets)[0];
  const byNar = new Map<string, number>();
  for (const k of cl) byNar.set(k.narrative, (byNar.get(k.narrative) ?? 0) + k.heat.quote_norm_in);
  const nar = [...byNar].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${c.cyan(n)} ${Math.round((v / (eth || 1)) * 100)}%`).join(" · ");
  L.push(`  ${c.dim("hottest   ")} ${c.bold(hottest.slug)}  ${STATUS_COLOR[hottest.status]?.(hottest.status) ?? hottest.status}  ${ethf(hottest.heat.quote_norm_in)} ETH · ${num(hottest.heat.unique_buyers)} buyers · ${hottest.heat.n_launches} CA  ${c.dim(hottest.narrative)}`);
  if (draining && draining.flow.out_wallets >= 8) L.push(`  ${c.dim("draining  ")} ${c.bold(draining.slug)}  ${STATUS_COLOR[draining.status]?.(draining.status) ?? draining.status}  ${num(draining.flow.out_wallets)} wallets left → ${cl.filter((k) => k.rotating_from === draining.slug).length} metas  ${c.dim("(narra flow)")}`);
  L.push(`  ${c.dim("narratives")} ${nar}`);
  if (r.reading) L.push("", `  ${r.reading}`);
  L.push("");
  // table, adapted to the terminal width
  const wide = W >= 118, mid = W >= 92;
  const rows = r.clusters.filter((k) => opts.all || k.status !== "DEAD");
  const top = opts.all ? rows.length : opts.top ?? 15;
  const shown = rows.slice(0, top);
  const head = wide ? ["#", "status", "meta", "narrative", "CA", "ETH in", "grad", "buyers", "flow", ""] : mid ? ["#", "status", "meta", "narrative", "CA", "ETH in", "buyers", "flow"] : ["#", "status", "meta", "ETH in", "buyers"];
  const body = shown.map((k) => {
    const h = k.heat;
    const flow = k.flow.in_wallets || k.flow.out_wallets ? c.dim(`${k.flow.in_wallets ? "⇦" + k.flow.in_wallets : ""}${k.flow.in_wallets && k.flow.out_wallets ? " " : ""}${k.flow.out_wallets ? "⇨" + k.flow.out_wallets : ""}`) : "";
    const from = k.rotating_from && k.rotating_from !== draining?.slug ? c.dim(`← ${k.rotating_from}`) : k.rotating_to ? c.dim(`→ ${k.rotating_to}`) : "";
    const narr = c.cyan(k.narrative + (k.narrative_sub ? "·" + k.narrative_sub : ""));
    const name = k.label_source && k.label_source !== "tags" ? `${k.slug} ${c.dim("· " + k.label)}` : k.slug;
    const st = STATUS_COLOR[k.status]?.(k.status) ?? k.status;
    return wide ? [String(k.rank), st, name, narr, String(h.n_launches), ethf(h.quote_norm_in), String(h.n_graduated), num(h.unique_buyers), flow, from]
      : mid ? [String(k.rank), st, name, narr, String(h.n_launches), ethf(h.quote_norm_in), num(h.unique_buyers), flow]
      : [String(k.rank), st, name, ethf(h.quote_norm_in), num(h.unique_buyers)];
  });
  const widths = wide ? [3, 12, 24, 18, 4, 8, 4, 7, 9, 0] : mid ? [3, 12, 24, 16, 4, 8, 7, 0] : [3, 12, 24, 8, 0];
  const right = new Set(wide ? [0, 4, 5, 6, 7] : mid ? [0, 4, 5, 6] : [0, 3, 4]);
  L.push(alignedTable([head.map((h) => c.dim(h)), ...body], widths, right));
  if (rows.length > shown.length) L.push(c.dim(`  … ${rows.length - shown.length} more (narra now --top ${rows.length} or --all${counts.DEAD ? `; ${counts.DEAD} DEAD hidden` : ""})`));
  if (opts.members) {
    for (const k of shown) {
      if (!k.members?.length) continue;
      L.push("", `${c.bold(k.slug)}  ${STATUS_COLOR[k.status]?.(k.status) ?? k.status}  ${c.dim("tags " + k.top_tags.map((t) => t.tag).join(" "))}`);
      const mrows = k.members.slice(0, 12).map((m) => [`  ${short(m.token)}`, m.symbol ? `$${m.symbol}`.slice(0, 14) : c.dim("(no symbol)"), m.phase, m.membership.toFixed(2), `${m.buyers_overlap} overlap`, m.last_trade_ts ? c.dim(ago(m.last_trade_ts)) : c.dim("no trades")]);
      L.push(table(mrows, [14, 15, 6, 5, 11, 0]));
    }
  }
  L.push("", c.dim(`${r.counts.clustered}/${r.counts.candidates} tokens in metas · ${r.counts.sprayers} sprayer wallets ignored · narra why <meta> · narra coin <CA> · narra find <word> · narra terminal`));
  return L.join("\n");
}

/** Table with per-column alignment; numbers right, text left. */
export function alignedTable(rows: string[][], widths: number[], right: Set<number>): string {
  return rows.map((r) => r.map((cell, i) => {
    const w = widths[i] ?? 0;
    if (!w) return cell;
    const pad = w - visibleWidth(cell);
    if (pad <= 0) return cell;
    return right.has(i) ? " ".repeat(pad) + cell : cell + " ".repeat(pad);
  }).join("  ").trimEnd()).join("\n");
}

export async function now(args: Args): Promise<number> {
  const { n, q, done } = open(args);
  try {
    const r = await n.now({ ...q, top: undefined, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (args.flags.json) printJson(r); else console.log(renderNow(r, { members: q.members, all: !!args.flags.all, top: q.top }));
    return 0;
  } finally { n.close(); }
}
