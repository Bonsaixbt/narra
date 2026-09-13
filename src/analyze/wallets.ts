/**
 * Wallet cohorts. Everything here is arithmetic over rows already in the cache: buys, sells, quote in and out,
 * timing relative to launch, and which clusters the tokens belonged to. No labels come from outside.
 *
 * Realised flow is quote_out − quote_in per wallet; it ignores what the wallet still holds (no price oracle),
 * so it is a flow number, not a P&L claim. Cohorts:
 *   sniper        ≥ 3 buys and ≥ 50 % of them landed within 5 seconds of the launch (the opening-tax window)
 *   sprayer       more distinct tokens than the window's cap (does not vote in clustering)
 *   rotator       bought in ≥ 3 different clusters and net flow > 0
 *   early-in-hot  ≥ 3 buys of HOT/EMERGING/ROTATING IN members within 5 minutes of launch
 */
import type { LaunchRow, SwapRow, TradeRow } from "../store/db.js";
import type { ClusterOut, Status } from "./types.js";
import { isLive } from "./status.js";

/** The opening tax decays over 3 s; with ±1 s interpolated timestamps, 5 s is the sniper window. */
export const FAST_SEC = 5;

export type Cohort = "sniper" | "sprayer" | "rotator" | "early-in-hot";

export interface WalletStat {
  wallet: string;
  buys: number; sells: number; tokens: number;
  quote_in: number; quote_out: number; net_eth: number;
  closed_tokens: number; wins: number;
  /** share of buys inside the first FAST_SEC seconds after launch */
  fast_share: number;
  median_entry_sec: number | null;
  clusters: string[];
  cohorts: Cohort[];
  last_ts: number;
}

export interface WalletInputs {
  trades: TradeRow[]; swaps: SwapRow[]; launches: Map<string, LaunchRow>;
  membership: Map<string, string>; statuses: Map<string, Status>;
  window: { from: number; to: number }; sprayerCap: number;
}

export function walletStats(i: WalletInputs): Map<string, WalletStat> {
  type Acc = { buys: number; sells: number; tokens: Set<string>; qin: number; qout: number; fast: number; delays: number[]; clusters: Set<string>; earlyHot: number; perToken: Map<string, { in: number; out: number }>; last: number };
  const acc = new Map<string, Acc>();
  const get = (w: string): Acc => { let a = acc.get(w); if (!a) { a = { buys: 0, sells: 0, tokens: new Set(), qin: 0, qout: 0, fast: 0, delays: [], clusters: new Set(), earlyHot: 0, perToken: new Map(), last: 0 }; acc.set(w, a); } return a; };
  const note = (w: string, token: string, side: "buy" | "sell", q: number, ts: number) => {
    const a = get(w);
    a.last = Math.max(a.last, ts);
    let pt = a.perToken.get(token); if (!pt) { pt = { in: 0, out: 0 }; a.perToken.set(token, pt); }
    if (side === "buy") {
      a.buys++; a.tokens.add(token); a.qin += q; pt.in += q;
      const l = i.launches.get(token);
      if (l) { const d = ts - l.ts; a.delays.push(d); if (d <= FAST_SEC) a.fast++; const slug = i.membership.get(token); if (slug) { a.clusters.add(slug); const st = i.statuses.get(slug); if (st && isLive(st) && d <= 300) a.earlyHot++; } }
    } else { a.sells++; a.qout += q; pt.out += q; }
  };
  for (const t of i.trades) { if (!t.token || t.ts < i.window.from || t.ts >= i.window.to) continue; note(t.recipient, t.token, t.side, t.quote_norm ?? 0, t.ts); }
  for (const s of i.swaps) { if (s.ts < i.window.from || s.ts >= i.window.to) continue; note(s.wallet, s.token, s.side, s.quote_norm ?? 0, s.ts); }
  const out = new Map<string, WalletStat>();
  for (const [w, a] of acc) {
    const closed = [...a.perToken.values()].filter((p) => p.out > 0);
    const cohorts: Cohort[] = [];
    const fastShare = a.buys ? a.fast / a.buys : 0;
    if (a.buys >= 3 && fastShare >= 0.5) cohorts.push("sniper");
    if (a.tokens.size > i.sprayerCap) cohorts.push("sprayer");
    if (a.clusters.size >= 3 && a.qout - a.qin > 0) cohorts.push("rotator");
    if (a.earlyHot >= 3) cohorts.push("early-in-hot");
    const sorted = [...a.delays].sort((x, y) => x - y);
    out.set(w, {
      wallet: w, buys: a.buys, sells: a.sells, tokens: a.tokens.size,
      quote_in: r3(a.qin), quote_out: r3(a.qout), net_eth: r3(a.qout - a.qin),
      closed_tokens: closed.length, wins: closed.filter((p) => p.out > p.in).length,
      fast_share: r2(fastShare), median_entry_sec: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      clusters: [...a.clusters], cohorts, last_ts: a.last,
    });
  }
  return out;
}

/** Cohort counts among a set of wallets (a cluster's buyers, a token's early buyers). */
export function cohortMix(wallets: Iterable<string>, stats: Map<string, WalletStat>): Record<Cohort, number> & { total: number } {
  const mix = { sniper: 0, sprayer: 0, rotator: 0, "early-in-hot": 0, total: 0 };
  for (const w of wallets) { const s = stats.get(w); if (!s) continue; mix.total++; for (const c of s.cohorts) mix[c]++; }
  return mix;
}

export function clusterStatuses(clusters: ClusterOut[]): Map<string, Status> { return new Map(clusters.map((c) => [c.slug, c.status])); }

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
