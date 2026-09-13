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
    // Timestamps for old launches come from the measured block rate, not one block read per launch.
    const rate = (nowTs - (await clock.timestamp(Math.max(0, head - 50_000)))) / Math.min(head, 50_000);
    const tsOfOld = (block: number) => Math.round(nowTs - (head - block) * rate);
    const found = await resolveCurves(ctx, unknown, from - 1, pairAddrs, tsOfOld);
    p.launches += found;
    store.resolveTradeTokens();
  }

  // Pair symbols, ETH/USD for stable pairs, then quote normalisation for the rows still missing it.
  await ensurePairs(ctx.store, ctx.http, [...pairAddrs]);
  await refreshEthUsd(store);
  normalizePending(store, nowTs - opts.windowSec);

  p.stage = "enrich"; opts.onProgress?.(p);
  for (let i = 0; i < 20; i++) {
    const e = await enrichPending(store, ctx.http, 250);
    p.enriched += e.enriched;
    opts.onProgress?.(p);
    if (e.enriched + e.failed < 250) break;
  }
  p.stage = "done"; opts.onProgress?.(p);
  return p;
}

/**
 * TokenLaunched has the curve as its 2nd indexed topic, so a filtered query per chunk finds old launches cheaply.
 * Public nodes cap the number of values in one topic filter, so curves go in batches of `batch`.
 */
async function resolveCurves(ctx: SyncContext, curves: string[], beforeBlock: number, pairAddrs: Set<string>, tsOf: (block: number) => number, maxBack = 600_000, step = 100_000, batch = 40): Promise<number> {
  const want = new Set(curves.map((c) => c.toLowerCase()));
  let found = 0;
  const floor = Math.max(0, beforeBlock - maxBack);
  for (let to = beforeBlock; want.size && to > floor; to -= step) {
    const from = Math.max(floor, to - step + 1);
    const list = [...want];
    for (let i = 0; i < list.length; i += batch) {
      const topicCurves = list.slice(i, i + batch).map((c) => ("0x" + c.slice(2).padStart(64, "0")) as `0x${string}`);
      const logs = (await ctx.gate.request("eth_getLogs", [{ address: ADDR.ponsFactory, topics: [TOPICS.tokenLaunched, null, topicCurves], fromBlock: hex(from), toBlock: hex(to) }])) as RawLog[];
      const rows = [];
      for (const l of logs) {
        const L = decodeLaunch(l, tsOf(Number(BigInt(l.blockNumber))));
        if (L) { rows.push(L); want.delete(L.curve); pairAddrs.add(L.pair); }
      }
      found += ctx.store.upsertLaunches(rows);
    }
  }
  return found;
}

/** ETH/USD for stable-pair normalisation. One public price endpoint, cached 5 minutes, disabled by NARRA_NO_USD=1. Stale value survives outages. */
export async function refreshEthUsd(store: Store, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<number | null> {
  if (process.env.NARRA_NO_USD === "1") return null;
  const at = Number(store.get("eth_usd_at") ?? 0);
  if (now - at < 5 * 60_000) return Number(store.get("eth_usd")) || null;
  try {
    const r = await fetchFn("https://api.coinbase.com/v2/prices/ETH-USD/spot", { headers: { accept: "application/json", "user-agent": "narra/0.1" }, signal: AbortSignal.timeout(6_000) });
    const j = (await r.json()) as { data?: { amount?: string } };
    const v = Number(j.data?.amount);
    if (v > 0) { store.set("eth_usd", String(v)); store.set("eth_usd_at", String(now)); return v; }
  } catch { /* keep the stale value */ }
  return Number(store.get("eth_usd")) || null;
}

function normalizePending(store: Store, sinceTs: number): void {
  const pairs = store.pairs();
  const ethUsd = Number(store.get("eth_usd") ?? "") || null;
  const rows = store.db.prepare(`SELECT t.tx_hash, t.log_index, t.quote_raw, l.pair FROM curve_trades t JOIN launches l ON l.token = t.token WHERE t.quote_norm IS NULL AND t.ts >= ?`).all(sinceTs) as { tx_hash: string; log_index: number; quote_raw: string; pair: string }[];
  const upd = rows.map((r) => ({ tx_hash: r.tx_hash, log_index: r.log_index, quote_norm: normalizeQuote(r.quote_raw, pairs.get(r.pair), ethUsd) })).filter((r) => r.quote_norm !== null);
  if (upd.length) store.setQuoteNorm(upd);
}
