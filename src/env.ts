/**
 * Minimal .env loader: `./.env` (project) then `~/.narra/.env` (user). Existing process.env wins.
 * Keys never leave the machine; both files are gitignored / outside the repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function loadEnv(paths: string[] = [join(process.cwd(), ".env"), join(homedir(), ".narra", ".env")]): string[] {
  const loaded: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) { process.env[k] = v; loaded.push(k); }
    }
  }
  return loaded;
}
