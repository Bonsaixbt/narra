import type { Args } from "./args.js";
import { open, printJson } from "./common.js";
import { c, utc, STATUS_COLOR, short, ago } from "./render.js";
import { alignedTable } from "./now.js";

export async function find(args: Args): Promise<number> {
  const text = args.pos.join(" ").trim();
  if (!text) { console.error("usage: narra find <word | ticker | 0xprefix>"); return 10; }
  const { n, q, done } = open(args);
  try {
    const r = await n.find(text, { ...q, onProgress: (p) => { q.onProgress?.(p); if (p.stage === "done") done(p); } });
    if (args.flags.json) { printJson(r); return 0; }
    console.log(`${c.bold("NARRA find")} "${text}"  ${c.dim(utc())}  window ${r.window}`);
    if (r.clusters.length) {
      console.log("", c.dim("metas"));
      console.log(alignedTable(r.clusters.map((k) => [`  #${k.rank}`, STATUS_COLOR[k.status]?.(k.status) ?? k.status, k.slug, c.cyan(k.narrative), `${k.eth.toFixed(2)} ETH`, `${k.buyers} buyers`, c.dim("matched " + k.why)]), [5, 12, 24, 14, 11, 12, 0], new Set([0, 4, 5])));
    }
    if (r.tokens.length) {
      console.log("", c.dim("tokens"));
      console.log(alignedTable(r.tokens.map((t) => [`  ${short(t.token)}`, t.symbol ? "$" + t.symbol : c.dim("(no symbol)"), t.name.slice(0, 24), t.phase, `${t.buyers} buyers`, t.cluster ? `${t.cluster} ${STATUS_COLOR[t.status ?? ""]?.(t.status ?? "") ?? ""}` : c.dim("no meta"), c.dim(ago(t.launched_at))]), [14, 14, 26, 6, 11, 30, 0], new Set([4])));
    }
    if (!r.clusters.length && !r.tokens.length) console.log(c.dim("  nothing in this window matches; try a shorter word or a wider --window"));
    else console.log("", c.dim("narra why <meta> · narra coin <CA>"));
    return r.clusters.length || r.tokens.length ? 0 : 3;
  } finally { n.close(); }
}
