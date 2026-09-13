import { rmSync, existsSync } from "node:fs";
import type { Args } from "./args.js";
import { str } from "./args.js";
import { resolveDbPath, Store } from "../store/db.js";

export async function cache(args: Args): Promise<number> {
  const path = resolveDbPath(str(args.flags.db) ?? process.env.NARRA_DB);
  const sub = args.pos[0] ?? "path";
  if (sub === "path") { console.log(path); return 0; }
  if (sub === "stats") { const s = new Store(path); console.log(JSON.stringify({ path, ...s.stats(), cursor: s.getCursor("main") ?? null }, null, 2)); s.close(); return 0; }
  if (sub === "normalize") { const { normalizePending } = await import("../ingest/sync.js"); const s = new Store(path); const t0 = Date.now(); const n = normalizePending(s, 0); s.close(); console.log(`normalized ${n} trades in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return 0; }
  if (sub === "vacuum") { const s = new Store(path); const before = s.db.prepare("PRAGMA page_count").get() as { page_count: number }; s.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); s.db.exec("VACUUM"); const after = s.db.prepare("PRAGMA page_count").get() as { page_count: number }; s.close(); console.log(`vacuum: ${before.page_count} → ${after.page_count} pages`); return 0; }
  if (sub === "clear") { for (const f of [path, path + "-wal", path + "-shm"]) if (existsSync(f)) rmSync(f); console.log(`removed ${path}`); return 0; }
  console.error("usage: narra cache [path|stats|normalize|vacuum|clear]"); return 10;
}
