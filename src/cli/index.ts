import type { Args } from "./args.js";
import { c } from "./render.js";

const HELP = `narra — which meta is printing on Pons v2 / Robinhood Chain right now

  narra now        [--window 15m|60m|4h] [--pair all|eth|stable|stock] [--members] [--top N] [--json]
  narra coin <CA…> [--json] [--quiet]           exit code: 0 IN · 1 EDGE · 2 OUT · 3 ORPHAN · 4 NOT_PONS
  narra flow       [--window 60m] [--json]
  narra why <slug> [--window 60m] [--json]
  narra watch      [--jsonl] [--only LAUNCH,STATUS,EDGE,GRAD,JOIN]
  narra doctor     [--json]
  narra backfill   [--window 60m]
  narra schema     [now|coin|flow|why|watch]
  narra cache      [clear|path]
  narra mcp                                     MCP server over stdio
  narra serve      [--port 4663]                local HTTP on 127.0.0.1

  --rpc <url[,url#nologs]>  --db <path>  --no-color
  env: NARRA_RPC_URL  NARRA_WS_URL  NARRA_DB  NARRA_RETENTION_H

read-only · no key · IN means membership in a live meta, not a recommendation`;

export async function run(args: Args): Promise<number> {
  if (args.flags["no-color"]) globalThis.__narraNoColor = true;
  if (args.cmd === "help" || args.flags.help) { console.log(HELP); return 0; }
  if (args.cmd === "version" || args.flags.version) { console.log("narra 0.1.0"); return 0; }
  switch (args.cmd) {
    case "doctor": return (await import("./doctor.js")).doctor(args);
    case "backfill": return (await import("./backfill.js")).backfill(args);
    case "now": return (await import("./now.js")).now(args);
    case "coin": return (await import("./coin.js")).coin(args);
    case "flow": return (await import("./flow.js")).flow(args);
    case "why": return (await import("./why.js")).why(args);
    case "watch": return (await import("./watch.js")).watch(args);
    case "schema": return (await import("./schema.js")).schema(args);
    case "cache": return (await import("./cache.js")).cache(args);
    case "mcp": return (await import("../mcp/server.js")).serveMcp(args);
    case "serve": return (await import("./serve.js")).serve(args);
    default:
      console.error(c.red(`unknown command "${args.cmd}"`)); console.log(HELP); return 10;
  }
}
