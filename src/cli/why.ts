import type { Args } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, utc, STATUS_COLOR, short, ago, eth } from "./render.js";
import type { WhyOut } from "../schemas.js";

export function renderWhy(r: WhyOut): string {
  const k = r.cluster, h = k.heat;
  const L = [`${c.bold(k.slug)}  ${STATUS_COLOR[k.status]?.(k.status) ?? k.status}   window ${r.window}   ${utc()}`,
    c.dim(`${h.n_launches} CA launched · ${k.n_members} members · ${h.n_alive} alive · ${eth(h.quote_norm_in).trim()} ETH in · ${h.unique_buyers} buyers · ${h.n_graduated} grad · ${Math.round(h.graduated_share * 100)}% in pool · fast buys ${Math.round(h.taxed_ratio * 100)}% · Δ ${h.delta_pct === null ? "n/a" : h.delta_pct + "%"}`),
    c.dim(`pairs eth ${h.pair_mix.eth} · stable ${h.pair_mix.stable} · stock ${h.pair_mix.stock} · held together by ${k.links.text} name links, ${k.links.semantic} semantic links, ${k.links.wallet} wallet links, ${k.links.deployer} same-deployer links`),
    ...(k.summary ? [c.dim(`${k.label} — ${k.summary} (${k.label_source})`)] : []), "", "tags"];
  for (const t of r.tags) L.push(`  ${t.tag.padEnd(16)} ${t.weight.toFixed(2)}  ${c.dim(t.examples.map((e) => "$" + e).join(" "))}`);
  if (r.edges_in.length || r.edges_out.length) {
    L.push("", "flow");
    for (const e of r.edges_in) L.push(`  ← ${e.from.padEnd(20)} ${e.wallets} wallets  ${e.quote_norm.toFixed(2)} ETH  ${e.deployers} dev`);
    for (const e of r.edges_out) L.push(`  → ${e.to.padEnd(20)} ${e.wallets} wallets  ${e.quote_norm.toFixed(2)} ETH  ${e.deployers} dev`);
  }
  L.push("", "members");
  const rows = (k.members ?? []).slice(0, 25).map((m) => [`  ${short(m.token)}`, m.symbol ? `$${m.symbol}`.slice(0, 14) : c.dim("(no symbol)"), m.phase, m.membership.toFixed(2), `${m.buyers_overlap} overlap`, c.dim(`launched ${ago(m.launched_ts)}`), m.last_trade_ts ? c.dim(`trade ${ago(m.last_trade_ts)}`) : c.dim("no trades")]);
  L.push(table(rows, [14, 15, 6, 5, 11, 18, 0]));
  L.push("", c.dim(`rule: ${r.rule}`));
  return L.join("\n");
}

export async function why(args: Args): Promise<number> {
  const slug = args.pos[0];
  if (!slug) { console.error("usage: narra why <cluster-slug>"); return 10; }
  const { n, q, done } = open(args);
  try {
    const r = await n.why(slug, { ...q, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (!r) { console.error(`no meta matches "${slug}" in window ${q.window}; try narra find ${slug}`); return 3; }
    if (args.flags.json) printJson(r); else console.log(renderWhy(r));
    return 0;
  } finally { n.close(); }
}
