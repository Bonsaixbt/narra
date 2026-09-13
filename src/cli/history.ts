/** History from the cache: cluster status timeline from snapshots, or a token's hourly curve+pool activity. */
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table, STATUS_COLOR, utc } from "./render.js";

export async function history(args: Args): Promise<number> {
  const target = args.pos[0];
  if (!target) { console.error("usage: narra history <cluster-slug | 0xTOKEN> [--hours 24]"); return 10; }
  const hours = Number(str(args.flags.hours) ?? 24);
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    if (/^0x[0-9a-fA-F]{40}$/.test(target)) {
      const token = target.toLowerCase();
      const rows = n.store.hourlyFor([token], since);
      const live = n.store.tradesForToken(token, 100_000).filter((t) => t.ts >= since);
      const swaps = n.store.swapsSince(since).filter((s) => s.token === token);
      const byHour = new Map<number, { curve_buys: number; curve_in: number; pool_buys: number; pool_in: number; buyers: Set<string> }>();
      const slot = (ts: number) => { const h = Math.floor(ts / 3600) * 3600; let r = byHour.get(h); if (!r) { r = { curve_buys: 0, curve_in: 0, pool_buys: 0, pool_in: 0, buyers: new Set() }; byHour.set(h, r); } return r; };
      for (const r of rows) { const s = slot(r.hour_ts); if (r.venue === "curve") { s.curve_buys += r.buys; s.curve_in += r.quote_in; } else { s.pool_buys += r.buys; s.pool_in += r.quote_in; } }
      for (const t of live) if (t.side === "buy") { const s = slot(t.ts); s.curve_buys++; s.curve_in += t.quote_norm ?? 0; s.buyers.add(t.recipient); }
      for (const s of swaps) if (s.side === "buy") { const x = slot(s.ts); x.pool_buys++; x.pool_in += s.quote_norm ?? 0; x.buyers.add(s.wallet); }
      const out = [...byHour].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({ hour: new Date(h * 1000).toISOString(), curve_buys: v.curve_buys, curve_in_eth: round(v.curve_in), pool_buys: v.pool_buys, pool_in_eth: round(v.pool_in), buyers: v.buyers.size }));
      if (args.flags.json) { printJson({ token, hours, rows: out }); return 0; }
      console.log(`${c.bold(token)}  last ${hours}h  ${utc()}`);
      console.log(table([["hour", "curve buys", "curve ETH", "pool buys", "pool ETH", "buyers"], ...out.map((r) => [r.hour.slice(5, 16), String(r.curve_buys), r.curve_in_eth.toFixed(2), String(r.pool_buys), r.pool_in_eth.toFixed(2), String(r.buyers)])], [17, 11, 10, 10, 9, 0]));
      return 0;
    }
    const snaps = n.store.snapshotHistory(target, since);
    if (!snaps.length) { console.error(`no snapshots for "${target}" in the last ${hours}h`); return 3; }
    const out = snaps.map((s) => { const p = JSON.parse(s.payload) as { heat?: { n_launches: number; quote_norm_in: number; unique_buyers: number; n_graduated: number }; members?: string[] }; return { ts: new Date(s.ts * 1000).toISOString(), window: s.window, status: s.status, n_launches: p.heat?.n_launches ?? 0, quote_eth: p.heat?.quote_norm_in ?? 0, buyers: p.heat?.unique_buyers ?? 0, graduations: p.heat?.n_graduated ?? 0, members: p.members?.length ?? 0 }; });
    if (args.flags.json) { printJson({ slug: target, hours, snapshots: out }); return 0; }
    console.log(`${c.bold(target)}  last ${hours}h  ${out.length} snapshots  ${utc()}`);
    // one line per status change plus the last row
    const lines: string[][] = [];
    let prev = "";
    out.forEach((r, i) => { if (r.status !== prev || i === out.length - 1) { lines.push([r.ts.slice(5, 16), r.window, STATUS_COLOR[r.status]?.(r.status.padEnd(12)) ?? r.status, `${r.n_launches} CA`, `${r.quote_eth.toFixed(2)} ETH`, `${r.buyers} buyers`, `${r.members} members`]); prev = r.status; } });
    console.log(table(lines, [17, 5, 13, 7, 11, 12, 0]));
    return 0;
  } finally { n.close(); }
}
const round = (x: number) => Math.round(x * 1000) / 1000;
