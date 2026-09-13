import { rmSync, existsSync } from "node:fs";
import type { Args } from "./args.js";
import { str } from "./args.js";
import { resolveDbPath, Store } from "../store/db.js";

export async function cache(args: Args): Promise<number> {
  const path = resolveDbPath(str(args.flags.db) ?? process.env.NARRA_DB);
  const sub = args.pos[0] ?? "path";
  if (sub === "path") { console.log(path); return 0; }
  if (sub === "stats") { const s = new Store(path); console.log(JSON.stringify({ path, ...s.stats(), cursor: s.getCursor("main") ?? null }, null, 2)); s.close(); return 0; }
  if (sub === "clear") { for (const f of [path, path + "-wal", path + "-shm"]) if (existsSync(f)) rmSync(f); console.log(`removed ${path}`); return 0; }
  console.error("usage: narra cache [path|stats|clear]"); return 10;
}
