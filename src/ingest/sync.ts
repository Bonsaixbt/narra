/**
 * Backfill and incremental sync of factory + curve logs into the store.
 * One cursor for both streams; chunks of `chunkBlocks`; timestamps interpolated between chunk edges.
 */
import type { PublicClient } from "viem";
import { ADDR } from "../chain/constants.js";
import { TOPICS } from "../chain/topics.js";
import type { Gate } from "../chain/rpc.js";
import type { Store, TradeRow } from "../store/db.js";
import { BlockClock } from "./blocks.js";
import { decodeLaunch, decodeLifecycle, decodeTrade, interpolator, type RawLog } from "./decode.js";
import { enrichPending, ensurePairs, normalizeQuote } from "./enrich.js";

const hex = (n: number) => "0x" + n.toString(16);
export const CURSOR = "main";

export interface SyncContext { store: Store; gate: Gate; http: PublicClient; clock: BlockClock }

export interface SyncProgress {
  stage: "plan" | "logs" | "resolve" | "enrich" | "done";
  fromBlock: number; toBlock: number; doneBlock: number;
  launches: number; trades: number; enriched: number; note?: string;
}

export interface SyncOptions {
  /** Ensure the cache covers at least this many seconds before now. */
  windowSec: number;
  chunkBlocks?: number;
  onProgress?: (p: SyncProgress) => void;
  /** Stay this many blocks behind head so a late block never leaves a hole. */
  headLag?: number;
}

export async function sync(ctx: SyncContext, opts: SyncOptions): Promise<SyncProgress> {
  const { store, gate, clock } = ctx;
  const chunk = opts.chunkBlocks ?? 2_000;
  const lag = opts.headLag ?? 2;
  const head = (await clock.head()) - lag;
  const nowTs = await clock.timestamp(head);
  const windowStart = await clock.blockAt(nowTs - opts.windowSec, head);
  const cursor = store.getCursor(CURSOR);
  // A cursor behind the window start means the cache has a hole outside the window; that is fine for the window itself.
  const from = cursor && cursor.last_block + 1 >= windowStart ? cursor.last_block + 1 : windowStart;
  const p: SyncProgress = { stage: "plan", fromBlock: from, toBlock: head, doneBlock: from - 1, launches: 0, trades: 0, enriched: 0 };
  opts.onProgress?.(p);
  if (cursor && cursor.last_block + 1 < windowStart) store.set("cache_gap_before", String(windowStart));

  const pairAddrs = new Set<string>();
  for (let a = from; a <= head; a += chunk) {
    const b = Math.min(a + chunk - 1, head);
    const [aTs, bTs] = await Promise.all([clock.timestamp(a), clock.timestamp(b)]);
    const tsOf = interpolator(a, aTs, b, bTs);
    const [factoryLogs, tradeLogs] = await Promise.all([
      gate.request("eth_getLogs", [{ address: ADDR.ponsFactory, topics: [[TOPICS.tokenLaunched, TOPICS.launchSwept, TOPICS.poolGraduated]], fromBlock: hex(a), toBlock: hex(b) }]) as Promise<RawLog[]>,
      gate.request("eth_getLogs", [{ topics: [[TOPICS.curveBuy, TOPICS.curveSell]], fromBlock: hex(a), toBlock: hex(b) }]) as Promise<RawLog[]>,
    ]);
    const launches = [];
    for (const l of factoryLogs) {
      const L = decodeLaunch(l, tsOf(Number(BigInt(l.blockNumber))));
      if (L) { launches.push(L); pairAddrs.add(L.pair); continue; }
      const ev = decodeLifecycle(l);
      if (ev?.kind === "swept") store.setLifecycle(ev.token, { phase: 1, swept_at: tsOf(ev.block) });
      if (ev?.kind === "graduated") store.setLifecycle(ev.token, { phase: 2, graduated_at: tsOf(ev.block), position_id: ev.positionId ?? null });
    }
    p.launches += store.upsertLaunches(launches);
    const trades: TradeRow[] = [];
    for (const l of tradeLogs) { const t = decodeTrade(l, tsOf(Number(BigInt(l.blockNumber)))); if (t) trades.push(t); }
    p.trades += store.insertTrades(trades);
    store.setCursor(CURSOR, b);
    p.stage = "logs"; p.doneBlock = b;
    opts.onProgress?.(p);
  }

  // Trades on curves launched before the window: find their launches by curve address, walking back in big chunks.
  p.stage = "resolve"; opts.onProgress?.(p);
  store.resolveTradeTokens();
  const unknown = store.unknownCurves(nowTs - opts.windowSec);
  if (unknown.length) {
    const found = await resolveCurves(ctx, unknown, from - 1, pairAddrs);
    p.launches += found;
    store.resolveTradeTokens();
  }

  // Pair symbols, then quote normalisation for the rows still missing it.
  await ensurePairs(ctx.store, ctx.http, [...pairAddrs]);
  normalizePending(store, nowTs - opts.windowSec);

  p.stage = "enrich"; opts.onProgress?.(p);
  const e = await enrichPending(store, ctx.http, 400);
  p.enriched = e.enriched;
  p.stage = "done"; opts.onProgress?.(p);
  return p;
}

/** TokenLaunched has the curve as its 2nd indexed topic, so one filtered query per 100k-block chunk finds old launches cheaply. */
async function resolveCurves(ctx: SyncContext, curves: string[], beforeBlock: number, pairAddrs: Set<string>, maxBack = 3_000_000, step = 100_000): Promise<number> {
  const want = new Set(curves.map((c) => c.toLowerCase()));
  let found = 0;
  let to = beforeBlock;
  const floor = Math.max(0, beforeBlock - maxBack);
  while (want.size && to > floor) {
    const from = Math.max(floor, to - step + 1);
    const topicCurves = [...want].map((c) => ("0x" + c.slice(2).padStart(64, "0")) as `0x${string}`);
    const logs = (await ctx.gate.request("eth_getLogs", [{ address: ADDR.ponsFactory, topics: [TOPICS.tokenLaunched, null, topicCurves], fromBlock: hex(from), toBlock: hex(to) }])) as RawLog[];
    const rows = [];
    for (const l of logs) {
      const blk = Number(BigInt(l.blockNumber));
      const L = decodeLaunch(l, await ctx.clock.timestamp(blk));
      if (L) { rows.push(L); want.delete(L.curve); pairAddrs.add(L.pair); }
    }
    found += ctx.store.upsertLaunches(rows);
    to = from - 1;
  }
  return found;
}

function normalizePending(store: Store, sinceTs: number): void {
  const pairs = store.pairs();
  const ethUsd = Number(store.get("eth_usd") ?? "") || null;
  const rows = store.db.prepare(`SELECT t.tx_hash, t.log_index, t.quote_raw, l.pair FROM curve_trades t JOIN launches l ON l.token = t.token WHERE t.quote_norm IS NULL AND t.ts >= ?`).all(sinceTs) as { tx_hash: string; log_index: number; quote_raw: string; pair: string }[];
  const upd = rows.map((r) => ({ tx_hash: r.tx_hash, log_index: r.log_index, quote_norm: normalizeQuote(r.quote_raw, pairs.get(r.pair), ethUsd) })).filter((r) => r.quote_norm !== null);
  if (upd.length) store.setQuoteNorm(upd);
}
