/**
 * Flow over time: one sampled tick per step (the last tick inside it), never a sum — consecutive windows overlap,
 * so adding ticks would count the same wallets many times. Ticks come from flow_ticks/flow_snapshots written by
 * every analysis; ticks that predate those tables are backfilled from cluster snapshots (membership) and stored
 * trades, the same computation the board runs.
 */
import type { Store } from "../store/db.js";
import { flowEdges } from "./flow.js";
import { WINDOWS, type WindowKey } from "../cli/args.js";

export const FLOW_STEPS = { "15m": 900, "1h": 3600, "4h": 14_400 } as const;
export type FlowStep = keyof typeof FLOW_STEPS;

export interface FlowHistorySlot {
  /** the tick sampled for this step, unix seconds; null when no tick fell inside it */
  ts: number | null;
  from_ts: number;
  nodes: { slug: string; status: string; id: string | null; first_seen_ts: number | null }[];
  edges: { from: string; to: string; wallets: number; eth: number; deployers: number }[];
}
export interface FlowHistoryOut { window: WindowKey; hours: number; step: FlowStep; step_s: number; since: number; until: number; slots: FlowHistorySlot[]; backfilled: number }

/** Sampled tick per step: the last snapshot tick at or before the slot's end that is not earlier than its start. */
export function sampleTicks(ticks: number[], since: number, stepSec: number, n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const end = since + (k + 1) * stepSec;
    let pick: number | null = null;
    while (i < ticks.length && ticks[i] < end) { if (ticks[i] >= since + k * stepSec) pick = ticks[i]; i++; }
    out.push(pick);
  }
  return out;
}

/** Recomputes the edges of ticks that have cluster snapshots but no flow row. Returns how many ticks were filled. */
export function backfillFlowHistory(store: Store, window: WindowKey, ticks: number[]): number {
  const have = new Set(store.flowTicks(window, ticks.length ? ticks[0] : 0));
  const windowSec = WINDOWS[window];
  let n = 0;
  for (const ts of ticks) {
    if (have.has(ts)) continue;
    const snaps = store.snapshotsAt(window, ts);
    const membership = new Map<string, string>();
    for (const s of snaps) for (const m of (JSON.parse(s.payload) as { members?: string[] }).members ?? []) membership.set(m, s.slug);
    // launches since the previous window: a superset of what the live tick saw (it only knew launches of traded tokens)
    const edges = membership.size ? flowEdges(membership, store.tradesBetween(ts - 2 * windowSec, ts + 1), store.launchesSince(ts - 2 * windowSec), { from: ts - windowSec, to: ts }) : [];
    store.saveFlowSnapshot(window, ts, edges);
    n++;
  }
  return n;
}

export function flowHistory(store: Store, window: WindowKey, hours: number, step: FlowStep, nowTs = Math.floor(Date.now() / 1000), opts: { backfill?: boolean } = {}): FlowHistoryOut {
  const stepSec = FLOW_STEPS[step];
  const n = Math.max(1, Math.ceil((hours * 3600) / stepSec));
  const until = nowTs, since = until - n * stepSec;
  const ticks = store.snapshotTicks(window, since);
  const sampled = sampleTicks(ticks, since, stepSec, n);
  const wanted = sampled.filter((t): t is number => t !== null);
  const backfilled = opts.backfill === false ? 0 : backfillFlowHistory(store, window, wanted);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const slots = sampled.map((ts, k) => {
    if (ts === null) return { ts: null, from_ts: since + k * stepSec, nodes: [], edges: [] };
    const nodes = store.snapshotsAt(window, ts).map((s) => ({ slug: s.slug, status: s.status, id: s.meta_id ?? null, first_seen_ts: s.first_seen ?? null }));
    const edges = store.flowEdgesAt(window, ts).map((e) => ({ from: e.from_slug, to: e.to_slug, wallets: e.wallets, eth: r3(e.quote_norm), deployers: e.deployers }));
    return { ts, from_ts: since + k * stepSec, nodes, edges };
  });
  return { window, hours, step, step_s: stepSec, since, until, slots, backfilled };
}
