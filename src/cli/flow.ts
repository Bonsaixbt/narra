import type { Args } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, utc, STATUS_COLOR } from "./render.js";
import type { FlowOut } from "../schemas.js";

export function renderFlow(r: FlowOut): string {
  const L = [`${c.bold("NARRA flow")}  ${utc()}   window ${r.window}   ${c.dim("repeat buyers and deployers moving between clusters")}`, ""];
  if (!r.edges.length) { L.push(c.dim("no edges above threshold (≥ 5 wallets or ≥ 2 deployers) in this window")); return L.join("\n"); }
  const st = new Map(r.nodes.map((n) => [n.slug, n.status]));
  const rows = r.edges.map((e) => [e.from, "→", e.to, `${e.wallets} w`, `${e.quote_norm.toFixed(2)} ETH`, `${e.deployers} dev`, c.dim(`${st.get(e.from) ?? "?"} → ${STATUS_COLOR[st.get(e.to) ?? ""]?.(st.get(e.to) ?? "?") ?? st.get(e.to)}`)]);
  L.push(table([["from", "", "to", "wallets", "quote", "deployers", ""], ...rows], [22, 1, 22, 8, 10, 9, 0]));
  return L.join("\n");
}

export async function flow(args: Args): Promise<number> {
  const { n, q, done } = open(args);
  try {
    const r = await n.flow({ ...q, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (args.flags.json) printJson(r); else console.log(renderFlow(r));
    return 0;
  } finally { n.close(); }
}
