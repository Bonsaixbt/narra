const enabled = () => !("NO_COLOR" in process.env) && process.stdout.isTTY === true && !globalThis.__narraNoColor;
declare global { var __narraNoColor: boolean | undefined }

const wrap = (code: string) => (s: string) => (enabled() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  dim: wrap("2"), bold: wrap("1"), red: wrap("31"), green: wrap("32"), yellow: wrap("33"), blue: wrap("34"), magenta: wrap("35"), cyan: wrap("36"), gray: wrap("90"),
};

export const STATUS_COLOR: Record<string, (s: string) => string> = {
  HOT: c.red, EMERGING: c.yellow, "ROTATING IN": c.red, "ROTATING OUT": c.magenta, COOLING: c.blue, DEAD: c.gray,
};
export const VERDICT_COLOR: Record<string, (s: string) => string> = {
  IN: c.green, EDGE: c.yellow, OUT: c.magenta, ORPHAN: c.gray, NOISE: c.cyan, NOT_PONS: c.red,
};

export const short = (a: string, n = 6) => (a.length > n + 6 ? `${a.slice(0, n)}…${a.slice(-4)}` : a);
export const eth = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "  n/a" : v.toFixed(d).padStart(5));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`);
export const ago = (ts: number, now = Date.now() / 1000) => {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};
export const utc = (ts = Date.now() / 1000) => new Date(ts * 1000).toISOString().slice(11, 19) + " UTC";

/** Left-aligned columns with a width per column; a width of 0 means "rest of the line". */
export function table(rows: string[][], widths: number[]): string {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  return rows.map((r) => r.map((cell, i) => {
    const w = widths[i] ?? 0;
    if (!w) return cell;
    const pad = w - strip(cell).length;
    return pad > 0 ? cell + " ".repeat(pad) : cell;
  }).join(" ").trimEnd()).join("\n");
}

export function progressLine(label: string, done: number, total: number, extra = ""): string {
  const width = 20;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(frac * width);
  return `  ${label.padEnd(10)} ${"█".repeat(filled)}${"░".repeat(width - filled)} ${Math.round(frac * 100).toString().padStart(3)}%  ${extra}`;
}
