/** Tiny argv parser: `narra <cmd> [positionals] [--flag value] [--bool]`. No dependency needed for eight commands. */
export interface Args { cmd: string; pos: string[]; flags: Record<string, string | boolean> }

const BOOL = new Set(["json", "jsonl", "quiet", "no-color", "members", "help", "version", "offline", "no-usd", "no-semantic"]);

export function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") { pos.push(...rest.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) { flags[k] = inline; continue; }
      if (BOOL.has(k) || rest[i + 1] === undefined || rest[i + 1].startsWith("--")) { flags[k] = true; continue; }
      flags[k] = rest[++i];
    } else if (a.startsWith("-") && a.length === 2 && a !== "-") {
      flags[{ j: "json", q: "quiet", w: "window", p: "pair", h: "help" }[a[1]] ?? a[1]] = BOOL.has({ j: "json", q: "quiet", h: "help" }[a[1]] ?? "") ? true : rest[++i] ?? true;
    } else pos.push(a);
  }
  return { cmd, pos, flags };
}

export const WINDOWS = { "15m": 900, "60m": 3600, "4h": 14_400 } as const;
export type WindowKey = keyof typeof WINDOWS;

export function windowOf(v: string | boolean | undefined, dflt: WindowKey = "60m"): WindowKey {
  if (typeof v !== "string") return dflt;
  const k = v === "1h" ? "60m" : v;
  if (!(k in WINDOWS)) throw new Error(`unknown window "${v}" (use 15m, 60m, 4h)`);
  return k as WindowKey;
}

export function str(v: string | boolean | undefined): string | undefined { return typeof v === "string" ? v : undefined; }
