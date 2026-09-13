import type { Args } from "./args.js";
import { str } from "./args.js";
import { Narra } from "../narra.js";
import { c, ago } from "./render.js";

export async function doctor(args: Args): Promise<number> {
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  try {
    const r = await n.doctor();
    if (args.flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 11; }
    const mark = (ok: boolean) => (ok ? c.green("ok  ") : c.red("FAIL"));
    console.log(c.bold("narra doctor"));
    console.log(`  chain      ${r.chain_id ?? "?"}   head ${r.head ?? "?"}`);
    console.log(`  rpc        ${r.rpc.map((e) => `${e.label}${e.logs ? "(logs)" : ""}${e.benched ? c.red("(benched)") : ""}`).join(" → ")}`);
    console.log(`  ws         ${r.ws ?? "off"}`);
    console.log(`  factory    launches ${r.factory.launch_enabled}  tax ${r.factory.snipe_tax_start_bps} bps / ${r.factory.snipe_tax_seconds} s  hook ${r.factory.meme_hook ?? "?"}`);
    for (const e of r.expectations) console.log(`  ${mark(e.ok)} ${e.name.padEnd(18)} ${e.detail}`);
    const k = r.cache;
    console.log(`  cache      ${k.path}`);
    console.log(`             ${k.launches} launches · ${k.tokens} tokens · ${k.trades} trades · cursor ${k.cursor_block ?? "none"}` + (k.newest_trade_ts ? ` · newest trade ${ago(k.newest_trade_ts)}` : ""));
    for (const e of r.errors) console.log(`  ${c.red("error")}  ${e}`);
    console.log(r.ok ? c.green("\nall good") : c.red("\nsomething is off, see above"));
    return r.ok ? 0 : 11;
  } finally { n.close(); }
}
