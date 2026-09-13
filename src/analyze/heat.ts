import type { LaunchRow, SwapRow, TradeRow } from "../store/db.js";
import type { Heat, TokenInfo } from "./types.js";

export interface Window { from: number; to: number }

export interface HeatInputs {
  members: Set<string>;
  tokens: Map<string, TokenInfo>;
  trades: TradeRow[];     // covers [to - 2W, to)
  swaps: SwapRow[];       // same range
  launches: LaunchRow[];  // same range
  window: Window;
  aliveWindowSec: number;
}

export function heatOf(i: HeatInputs): Heat {
  const { from, to } = i.window;
  const W = to - from;
  const prevFrom = from - W;
  let quoteNow = 0, quotePrev = 0, buys = 0, taxed = 0, poolNow = 0;
  const buyers = new Set<string>();
  const aliveTokens = new Set<string>();
  const aliveCutoff = to - i.aliveWindowSec;
  for (const t of i.trades) {
    if (!t.token || !i.members.has(t.token)) continue;
    if (t.side !== "buy") continue;
    if (t.ts >= from && t.ts < to) {
      buys++; if (BigInt(t.tax_raw) > 0n) taxed++;
      quoteNow += t.quote_norm ?? 0; buyers.add(t.recipient);
      if (t.ts >= aliveCutoff) aliveTokens.add(t.token);
    } else if (t.ts >= prevFrom && t.ts < from) quotePrev += t.quote_norm ?? 0;
  }
  for (const s of i.swaps) {
    if (!i.members.has(s.token) || s.side !== "buy") continue;
    if (s.ts >= from && s.ts < to) { poolNow += s.quote_norm ?? 0; buyers.add(s.wallet); if (s.ts >= aliveCutoff) aliveTokens.add(s.token); }
    else if (s.ts >= prevFrom && s.ts < from) quotePrev += s.quote_norm ?? 0;
  }
  let nLaunches = 0, nGraduated = 0;
  const mix = { eth: 0, stable: 0, stock: 0, other: 0 };
  for (const l of i.launches) {
    if (!i.members.has(l.token)) continue;
    if (l.ts >= from && l.ts < to) nLaunches++;
    if (l.graduated_at !== null && l.graduated_at >= from && l.graduated_at < to) nGraduated++;
  }
  let inPool = 0;
  for (const m of i.members) {
    const t = i.tokens.get(m);
    if (!t) continue;
    mix[t.pairKind]++;
    if (t.phase === "pool") inPool++;
  }
  const total = quoteNow + poolNow;
  const delta = quotePrev > 0 ? Math.round(((total - quotePrev) / quotePrev) * 100) : total > 0 ? null : null;
  return {
    n_launches: nLaunches,
    n_members: i.members.size,
    n_alive: aliveTokens.size,
    quote_norm_in: round3(total),
    unique_buyers: buyers.size,
    n_graduated: nGraduated,
    graduated_share: i.members.size ? round2(inPool / i.members.size) : 0,
    taxed_ratio: buys ? round2(taxed / buys) : 0,
    pool_volume_norm: round3(poolNow),
    delta_pct: delta,
    pair_mix: mix,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
