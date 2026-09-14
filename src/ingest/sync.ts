/**
 * Backfill and incremental sync of factory + curve logs into the store.
 * One cursor for both streams; chunks of `chunkBlocks`; timestamps interpolated between chunk edges.
 */
import type { PublicClient, Address } from "viem";
import { ADDR } from "../chain/constants.js";
import { TOPICS } from "../chain/topics.js";
import type { Gate } from "../chain/rpc.js";
import type { Store, TradeRow } from "../store/db.js";
import { BlockClock } from "./blocks.js";
import { decodeLaunch, decodeLifecycle, decodeTrade, interpolator, type RawLog } from "./decode.js";
import { curveAbi, factoryAbi } from "../chain/abi.js";
import { enrichPending, ensurePairs, normalizeQuote } from "./enrich.js";
import { syncPools } from "./pools.js";

const hex = (n: number) => "0x" + n.toString(16);
export const CURSOR = "main";
/** Blocks re-read after a detected reorg. Arbitrum-stack chains rarely reorg; 200 blocks is ~20 s of chain. */
export const REORG_REWIND = 200;

export interface SyncContext { store: Store; gate: Gate; http: PublicClient; clock: BlockClock }

export interface SyncProgress {
  stage: "plan" | "logs" | "resolve" | "enrich" | "pools" | "done";
  fromBlock: number; toBlock: number; doneBlock: number;
  launches: number; trades: number; enriched: number; pools: number; swaps: number; note?: string;
}

export interface SyncOptions {
  /** Ensure the cache covers at least this many seconds before now. */
  windowSec: number;
  chunkBlocks?: number;
  onProgress?: (p: SyncProgress) => void;
  /** Stay this many blocks behind head so a late block never leaves a hole. */
  headLag?: number;
  /** Chunks fetched at once. Default: the first endpoint's concurrency (6 on a private node, 2 on public). */
  concurrency?: number;
}

/**
 * Runs `fn` over [from, to] in chunks with bounded concurrency and calls `advance(b)` only for the highest block up to
 * which every chunk has completed, so a cursor never skips over a chunk that is still in flight.
 */
export async function runChunks(from: number, to: number, chunk: number, concurrency: number, fn: (a: number, b: number) => Promise<void>, advance: (b: number) => void): Promise<void> {
  const starts: number[] = [];
  for (let a = from; a <= to; a += chunk) starts.push(a);
  const done = new Set<number>();
  let next = 0, contiguous = 0;
  const worker = async () => {
    while (next < starts.length) {
      const i = next++;
      const a = starts[i], b = Math.min(a + chunk - 1, to);
      await fn(a, b);
      done.add(i);
      while (contiguous < starts.length && done.has(contiguous)) { advance(Math.min(starts[contiguous] + chunk - 1, to)); contiguous++; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, starts.length)) }, worker));
}

export async function sync(ctx: SyncContext, opts: SyncOptions): Promise<SyncProgress> {
  const { store, gate, clock } = ctx;
  const chunk = opts.chunkBlocks ?? 2_000;
  const lag = opts.headLag ?? 2;
  const head = (await clock.head()) - lag;
  const nowTs = await clock.timestamp(head);
  const windowStart = await clock.blockAt(nowTs - opts.windowSec, head);
  let cursor = store.getCursor(CURSOR);
  // Reorg check: the block hash stored with the cursor must still be canonical. If not, drop the tail and re-read it.
  if (cursor?.last_block_hash) {
    const blk = (await gate.request("eth_getBlockByNumber", [hex(cursor.last_block), false])) as { hash?: string } | null;
    if (blk && blk.hash && blk.hash.toLowerCase() !== cursor.last_block_hash.toLowerCase()) {
      const rewindTo = Math.max(0, cursor.last_block - REORG_REWIND);
      store.dropFromBlock(rewindTo + 1);
      store.setCursor(CURSOR, rewindTo, null);
      cursor = store.getCursor(CURSOR);
      opts.onProgress?.({ stage: "plan", fromBlock: rewindTo + 1, toBlock: head, doneBlock: rewindTo, launches: 0, trades: 0, enriched: 0, pools: 0, swaps: 0, note: `reorg at ${cursor?.last_block}: rewound ${REORG_REWIND} blocks` });
    }
  }
  // Coverage is [oldest_block, cursor]. A window deeper than the coverage is filled backwards first; a cursor that fell
  // behind the window start (the tool was not run for a while) restarts coverage at the window start.
  const oldest = Number(store.get("oldest_block") ?? store.minBlock("curve_trades") ?? 0);
  const stale = !!cursor && cursor.last_block + 1 < windowStart;
  const from = cursor && !stale ? cursor.last_block + 1 : windowStart;
  const backFrom = cursor && !stale && oldest > windowStart ? windowStart : null;
  const backTo = backFrom !== null ? oldest - 1 : null;
  const p: SyncProgress = { stage: "plan", fromBlock: backFrom ?? from, toBlock: head, doneBlock: (backFrom ?? from) - 1, launches: 0, trades: 0, enriched: 0, pools: 0, swaps: 0 };
  opts.onProgress?.(p);
  if (!cursor || stale || backFrom !== null) store.set("oldest_block", String(backFrom ?? from));

  const pairAddrs = new Set<string>();
  const concurrency = opts.concurrency ?? gate.stats().endpoints[0]?.concurrency ?? 2;
  const chunkBody = async (a: number, b: number) => {
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
    p.stage = "logs";
  };
  if (backFrom !== null && backTo !== null && backTo >= backFrom) {
    await runChunks(backFrom, backTo, chunk, concurrency, chunkBody, (b) => { p.doneBlock = b; opts.onProgress?.(p); });
  }
  await runChunks(from, head, chunk, concurrency, chunkBody, (b) => { store.setCursor(CURSOR, b); p.doneBlock = b; opts.onProgress?.(p); });
  // remember the canonical hash of the cursor block for the next run's reorg check
  try { const blk = (await gate.request("eth_getBlockByNumber", [hex(head), false])) as { hash?: string } | null; if (blk?.hash) store.setCursor(CURSOR, head, blk.hash); } catch { /* the hash is a check, not a requirement */ }

  // Trades on curves launched before the window: find their launches by curve address, walking back in big chunks.
  p.stage = "resolve"; opts.onProgress?.(p);
  store.resolveTradeTokens();
  // Curves searched before are not walked again until the search horizon moves on by a full depth.
  const searched: Record<string, number> = JSON.parse(store.get("unresolved_curves") ?? "{}");
  const unknown = store.unknownCurves(nowTs - opts.windowSec).filter((c) => !(searched[c] && head - searched[c] < 600_000));
  if (unknown.length) {
    // Launch blocks for old curves come from the measured block rate, not one block read per launch.
    const rate = (nowTs - (await clock.timestamp(Math.max(0, head - 50_000)))) / Math.min(head, 50_000);
    const blockOfOld = (ts: number) => Math.max(0, Math.round(head - (nowTs - ts) / rate));
    const found = await resolveCurves(ctx, unknown, pairAddrs, blockOfOld);
    p.launches += found;
    store.resolveTradeTokens();
    const still = new Set(store.unknownCurves(nowTs - opts.windowSec));
    for (const c of unknown) if (still.has(c)) searched[c] = head;
    for (const c of Object.keys(searched)) if (head - searched[c] > 2_000_000) delete searched[c];
    store.set("unresolved_curves", JSON.stringify(searched));
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
  p.stage = "pools"; opts.onProgress?.(p);
  if (process.env.NARRA_NO_POOLS !== "1") {
    try {
      const pp = await syncPools(ctx, { head, nowTs, windowSec: opts.windowSec, concurrency, onProgress: (x) => { p.pools = x.pools; p.swaps = x.swaps; opts.onProgress?.(p); } });
      p.pools = pp.pools; p.swaps = pp.swaps;
    } catch (e) { p.note = `pools: ${(e as Error).message.split("\n")[0]}`; }
  }
  p.stage = "done"; opts.onProgress?.(p);
  return p;
}

/**
 * TokenLaunched has the curve as its 2nd indexed topic, so a filtered query per chunk finds old launches cheaply.
 * Public nodes cap the number of values in one topic filter, so curves go in batches of `batch`.
 */
/**
 * Launch rows for curves that traded inside the window but were launched before the cache began. The curve itself
 * knows its token and launch time (`token()`, `launchedAt()`) and the factory knows the rest (`getLaunchedToken`):
 * two multicalls per hundred curves. Walking factory logs backwards cost about a hundred eth_getLogs a tick.
 */
export async function resolveCurves(ctx: Pick<SyncContext, "store" | "http">, curves: string[], pairAddrs: Set<string>, blockOf: (ts: number) => number, batch = 100): Promise<number> {
  let found = 0;
  for (let i = 0; i < curves.length; i += batch) {
    const chunk = curves.slice(i, i + batch);
    const reads = chunk.flatMap((c) => [
      { address: c as Address, abi: curveAbi, functionName: "token" as const },
      { address: c as Address, abi: curveAbi, functionName: "launchedAt" as const },
    ]);
    let r: { status: "success" | "failure"; result?: unknown }[];
    try { r = (await ctx.http.multicall({ contracts: reads, allowFailure: true, batchSize: 0 })) as typeof r; } catch { continue; }
    const known: { curve: string; token: string; ts: number }[] = [];
    chunk.forEach((curve, k) => {
      const t = r[2 * k], at = r[2 * k + 1];
      if (t?.status === "success" && typeof t.result === "string") known.push({ curve, token: t.result.toLowerCase(), ts: at?.status === "success" ? Number(at.result) : 0 });
    });
    if (!known.length) continue;
    let infos: { status: "success" | "failure"; result?: unknown }[];
    try { infos = (await ctx.http.multicall({ contracts: known.map((k) => ({ address: ADDR.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken" as const, args: [k.token as Address] })), allowFailure: true, batchSize: 0 })) as typeof infos; } catch { continue; }
    const rows = known.flatMap((k, j) => {
      const s = infos[j]?.status === "success" ? (infos[j].result as { deployer: string; pairToken: string; graduationThreshold: bigint; phase: number; sweptAt: bigint; exists: boolean }) : null;
      if (!s?.exists) return [];
      pairAddrs.add(s.pairToken.toLowerCase());
      return [{ token: k.token, curve: k.curve.toLowerCase(), deployer: s.deployer.toLowerCase(), pair: s.pairToken.toLowerCase(), launch_config_id: 0, graduation_threshold: s.graduationThreshold.toString(), block: blockOf(k.ts), tx_hash: "", log_index: 0, ts: k.ts, phase: Number(s.phase), swept_at: Number(s.sweptAt) || null, graduated_at: null, position_id: null, pool_id: null }];
    });
    found += ctx.store.upsertLaunches(rows);
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

/** Fills quote_norm for resolved trades that lack it, in batches so a deep backfill never holds one giant transaction. */
export function normalizePending(store: Store, sinceTs: number, batch = 50_000): number {
  const pairs = store.pairs();
  const ethUsd = Number(store.get("eth_usd") ?? "") || null;
  let total = 0;
  for (;;) {
    const rows = store.db.prepare(`SELECT t.rowid AS rid, t.quote_raw, l.pair FROM curve_trades t JOIN launches l ON l.token = t.token WHERE t.quote_norm IS NULL AND t.ts >= ? AND (l.pair = '0x0000000000000000000000000000000000000000' OR l.pair IN (SELECT address FROM pairs WHERE kind = 'stable')) LIMIT ?`).all(sinceTs, batch) as { rid: number; quote_raw: string; pair: string }[];
    if (!rows.length) break;
    const upd = rows.map((r) => ({ rid: r.rid, quote_norm: normalizeQuote(r.quote_raw, pairs.get(r.pair), ethUsd) }));
    const st = store.db.prepare(`UPDATE curve_trades SET quote_norm = ? WHERE rowid = ?`);
    store.db.transaction(() => { for (const u of upd) st.run(u.quote_norm ?? -1, u.rid); })(); // -1 marks "cannot normalise" so the loop terminates; read as null below
    total += upd.length;
    if (rows.length < batch) break;
  }
  store.db.prepare(`UPDATE curve_trades SET quote_norm = NULL WHERE quote_norm = -1 AND ts >= ?`).run(sinceTs);
  return total;
}
