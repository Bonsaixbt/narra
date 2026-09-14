/**
 * Flow between clusters: wallets that bought ≥2 tokens of A in the previous window and ≥1 token of B in the current one,
 * plus deployers that launched in A before and in B now. Every edge is a count you can recompute from the trades table.
 */
import type { LaunchRow, TradeRow } from "../store/db.js";
import type { Edge, Move } from "./types.js";
import type { Window } from "./heat.js";

export interface FlowOptions { minWallets: number; minDeployers: number; maxTokensPerWallet: number }
export const DEFAULT_FLOW_OPTIONS: FlowOptions = { minWallets: 5, minDeployers: 2, maxTokensPerWallet: 60 };

export function flowEdges(membership: Map<string, string>, trades: TradeRow[], launches: LaunchRow[], window: Window, opts: FlowOptions = DEFAULT_FLOW_OPTIONS): Edge[] {
  const { from, to } = window;
  const prevFrom = from - (to - from);
  // wallet → cluster → set of tokens bought in the previous window
  const prevBuys = new Map<string, Map<string, Set<string>>>();
  const currBuys = new Map<string, Map<string, number>>(); // wallet → cluster → quote_norm
  const firstBuy = new Map<string, Map<string, Move>>();   // wallet → cluster → the earliest buy into it this window
  const walletTokenCount = new Map<string, number>();
  for (const t of trades) {
    if (!t.token || t.side !== "buy") continue;
    const c = membership.get(t.token); if (!c) continue;
    if (t.ts >= prevFrom && t.ts < from) {
      let m = prevBuys.get(t.recipient); if (!m) { m = new Map(); prevBuys.set(t.recipient, m); }
      let s = m.get(c); if (!s) { s = new Set(); m.set(c, s); }
      s.add(t.token);
      walletTokenCount.set(t.recipient, (walletTokenCount.get(t.recipient) ?? 0) + 1);
    } else if (t.ts >= from && t.ts < to) {
      let m = currBuys.get(t.recipient); if (!m) { m = new Map(); currBuys.set(t.recipient, m); }
      m.set(c, (m.get(c) ?? 0) + (t.quote_norm ?? 0));
      let f = firstBuy.get(t.recipient); if (!f) { f = new Map(); firstBuy.set(t.recipient, f); }
      const prevMove = f.get(c);
      if (!prevMove || t.ts < prevMove.ts) f.set(c, { wallet: t.recipient, token: t.token, ts: t.ts, eth: Math.round((t.quote_norm ?? 0) * 1e6) / 1e6, tx: t.tx_hash });
      walletTokenCount.set(t.recipient, (walletTokenCount.get(t.recipient) ?? 0) + 1);
    }
  }
  const edges = new Map<string, Edge>();
  const edge = (a: string, b: string) => { const k = `${a}→${b}`; let e = edges.get(k); if (!e) { e = { from: a, to: b, wallets: 0, quote_norm: 0, deployers: 0, moves: [] }; edges.set(k, e); } return e; };
  for (const [w, prev] of prevBuys) {
    if ((walletTokenCount.get(w) ?? 0) > opts.maxTokensPerWallet) continue;
    const curr = currBuys.get(w); if (!curr) continue;
    for (const [a, toks] of prev) {
      if (toks.size < 2) continue;
      for (const [b, q] of curr) { if (a === b) continue; const e = edge(a, b); e.wallets++; e.quote_norm += q; const mv = firstBuy.get(w)?.get(b); if (mv) e.moves!.push(mv); }
    }
  }
  // deployers
  const prevDep = new Map<string, Set<string>>(), currDep = new Map<string, Set<string>>();
  for (const l of launches) {
    const c = membership.get(l.token); if (!c) continue;
    const m = l.ts >= prevFrom && l.ts < from ? prevDep : l.ts >= from && l.ts < to ? currDep : null;
    if (!m) continue;
    let s = m.get(l.deployer); if (!s) { s = new Set(); m.set(l.deployer, s); }
    s.add(c);
  }
  for (const [d, prev] of prevDep) {
    const curr = currDep.get(d); if (!curr) continue;
    for (const a of prev) for (const b of curr) if (a !== b) edge(a, b).deployers++;
  }
  return [...edges.values()]
    .filter((e) => e.wallets >= opts.minWallets || e.deployers >= opts.minDeployers)
    .map((e) => ({ ...e, quote_norm: Math.round(e.quote_norm * 1000) / 1000, moves: (e.moves ?? []).sort((x, y) => x.ts - y.ts) }))
    .sort((a, b) => b.wallets - a.wallets || b.deployers - a.deployers);
}
