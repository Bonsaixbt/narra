import type { Args } from "./args.js";
import { str, windowOf } from "./args.js";
import { Narra } from "../narra.js";
import { c, progressLine } from "./render.js";
import type { SyncProgress } from "../ingest/sync.js";

/** Progress renderer shared by backfill and the cold start of every command. */
export function syncReporter(label: string): { onProgress: (p: SyncProgress) => void; finish: (p: SyncProgress, ms: number) => void } {
  const tty = process.stderr.isTTY;
  let lines = 0;
  const draw = (p: SyncProgress) => {
    const total = p.toBlock - p.fromBlock + 1;
    const done = p.doneBlock - p.fromBlock + 1;
    const out = [
      c.dim(`narra · ${label} · blocks ${p.fromBlock}…${p.toBlock}`),
      progressLine("logs", done, total, `${p.launches} launches · ${p.trades} trades`),
      progressLine(p.stage === "enrich" || p.stage === "pools" || p.stage === "done" ? "enrich" : "resolve", p.stage === "done" || p.stage === "pools" ? 1 : p.stage === "enrich" ? 0.5 : p.stage === "resolve" ? 0.2 : 0, 1, p.enriched ? `${p.enriched} tokens` : ""),
      progressLine("pools", p.stage === "done" ? 1 : p.stage === "pools" ? 0.5 : 0, 1, p.pools || p.swaps ? `${p.pools} pools · ${p.swaps} swaps` : ""),
    ];
    if (tty) { if (lines) process.stderr.write(`\x1b[${lines}A`); process.stderr.write(out.map((l) => `\x1b[2K${l}`).join("\n") + "\n"); lines = out.length; }
  };
  return {
    onProgress: draw,
    finish: (p, ms) => { if (tty) draw(p); process.stderr.write(c.dim(`  ready in ${(ms / 1000).toFixed(1)}s · ${p.launches} launches · ${p.trades} trades · ${p.enriched} enriched · ${p.swaps} pool swaps${p.note ? " · " + p.note : ""}\n`)); },
  };
}

export async function backfill(args: Args): Promise<number> {
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  const hours = Number(str(args.flags.hours) ?? 0);
  const w = hours > 0 ? hours * 3600 : windowOf(args.flags.window);
  const rep = syncReporter(`backfill ${hours > 0 ? hours + "h" : w}`);
  const t0 = Date.now();
  try {
    const p = await n.sync(w, rep.onProgress);
    rep.finish(p, Date.now() - t0);
    if (args.flags.json) console.log(JSON.stringify(p));
    return 0;
  } finally { n.close(); }
}
