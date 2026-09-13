import { Narra } from "../narra.js";
import type { Args } from "./args.js";
import { str, windowOf } from "./args.js";
import { syncReporter } from "./backfill.js";
import type { QueryOptions } from "../narra.js";

export function open(args: Args): { n: Narra; q: QueryOptions; done: (p: import("../ingest/sync.js").SyncProgress) => void } {
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  const window = windowOf(args.flags.window);
  const cold = !n.store.getCursor("main");
  const quiet = !!args.flags.json || !!args.flags.jsonl || !!args.flags.quiet;
  const rep = !quiet || cold ? syncReporter(cold ? `cold start · fetching last ${window} from ${n.clients.gate.labels()}` : `sync ${window}`) : null;
  const t0 = Date.now();
  const pair = (str(args.flags.pair) ?? "all") as QueryOptions["pair"];
  if (!["all", "eth", "stable", "stock"].includes(pair!)) throw new Error(`unknown pair "${pair}" (all, eth, stable, stock)`);
  const q: QueryOptions = { window, pair, members: !!args.flags.members, top: Number(str(args.flags.top) ?? 0) || undefined, noSync: !!args.flags.offline, noSemantic: !!args.flags["no-semantic"], onProgress: rep?.onProgress };
  return { n, q, done: (p) => rep?.finish(p, Date.now() - t0) };
}

export function printJson(v: unknown): void { console.log(JSON.stringify(v, null, process.stdout.isTTY ? 2 : 0)); }
