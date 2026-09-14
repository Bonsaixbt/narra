/**
 * Life after graduation. Pons sweeps the curve into a Uniswap v4 pool behind its own hook; from then on the token
 * trades through the PoolManager. We index:
 *   - Initialize on the PoolManager whose `hooks` is the Pons meme hook → pools(pool_id → token, pair)
 *   - Swap on the PoolManager for those pool ids → pool_swaps
 * Sign convention, verified on chain 2026-09-13: a positive amount is what the swapper receives. A buy of the token
 * therefore has token amount > 0 and a Transfer of the token FROM the PoolManager in the same transaction; that
 * Transfer's `to` is the wallet. Sells mirror it (Transfer TO the PoolManager, `from` is the wallet). This gives
 * wallet attribution with one log query per chunk instead of one transaction read per swap.
 */
import type { Address } from "viem";
import { ADDR } from "../chain/constants.js";
import { factoryAbi } from "../chain/abi.js";
import { TOPICS } from "../chain/topics.js";
import { decodePoolInit, decodePoolSwap, interpolator, type RawLog } from "./decode.js";
import { normalizeQuote } from "./enrich.js";
import { runChunks, type SyncContext } from "./sync.js";
import type { PoolRow, SwapRow } from "../store/db.js";

const hex = (n: number) => "0x" + n.toString(16);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => ("0x" + a.slice(2).toLowerCase().padStart(64, "0")) as `0x${string}`;

export const POOLS_INIT_CURSOR = "pools_init";
export const POOLS_SWAP_CURSOR = "pools_swap";

export async function memeHook(ctx: SyncContext): Promise<string> {
  const cached = ctx.store.get("meme_hook");
  if (cached) return cached;
  const h = (await ctx.http.readContract({ address: ADDR.ponsFactory, abi: factoryAbi, functionName: "memeHook" })).toLowerCase();
  ctx.store.set("meme_hook", h);
  return h;
}

export interface PoolsProgress { pools: number; swaps: number; unattributed: number }

export async function syncPools(ctx: SyncContext, opts: { head: number; nowTs: number; windowSec: number; initLookbackSec?: number; concurrency?: number; onProgress?: (p: PoolsProgress) => void }): Promise<PoolsProgress> {
  const { store, gate, clock } = ctx;
  const hook = await memeHook(ctx);
  const p: PoolsProgress = { pools: 0, swaps: 0, unattributed: 0 };

  // 1. Initialize: deep but cheap (address + topic filter, a few hundred events a day).
  const initCursor = store.getCursor(POOLS_INIT_CURSOR);
  const initFrom = initCursor ? initCursor.last_block + 1 : await clock.blockAt(opts.nowTs - (opts.initLookbackSec ?? 7 * 86_400), opts.head);
  for (let a = initFrom; a <= opts.head; a += 200_000) {
    const b = Math.min(a + 199_999, opts.head);
    const logs = (await gate.request("eth_getLogs", [{ address: ADDR.v4PoolManager, topics: [TOPICS.poolInitialize], fromBlock: hex(a), toBlock: hex(b) }])) as RawLog[];
    const rows: PoolRow[] = [];
    for (const l of logs) {
      const d = decodePoolInit(l);
      if (!d || d.hooks !== hook) continue;
      const candidates = [d.currency0, d.currency1].filter((c) => c !== ADDR.zero);
      const launches = store.launchesFor(candidates);
      const launch = launches.find((L) => candidates.includes(L.token));
      if (!launch) continue; // a Pons pool for a token outside our cache; picked up when the token is
      rows.push({ pool_id: d.poolId, token: launch.token, currency0: d.currency0, currency1: d.currency1, fee: d.fee, tick_spacing: d.tickSpacing, hooks: d.hooks, init_block: d.block });
    }
    for (const r of rows) { store.upsertPool(r); store.setLifecycle(r.token, { pool_id: r.pool_id }); }
    p.pools += rows.length;
    store.setCursor(POOLS_INIT_CURSOR, b);
  }
  // Pools whose Initialize we saw before the launch was cached: retry the mapping from stored lifecycle rows.
  const pools = store.pools();
  if (!pools.size) { opts.onProgress?.(p); return p; }
  const byToken = new Map([...pools.values()].map((x) => [x.token, x]));
  const pairs = store.pairs();
  const ethUsd = Number(store.get("eth_usd") ?? "") || null;
  const launchPair = new Map(store.launchesFor([...byToken.keys()]).map((l) => [l.token, l.pair]));

  // 2. Swaps + Transfers in window chunks.
  const swapCursor = store.getCursor(POOLS_SWAP_CURSOR);
  const windowStart = await clock.blockAt(opts.nowTs - opts.windowSec, opts.head);
  const oldest = Number(store.get("pools_oldest_block") ?? store.minBlock("pool_swaps") ?? 0);
  const stale = !!swapCursor && swapCursor.last_block + 1 < windowStart;
  const from = swapCursor && !stale ? swapCursor.last_block + 1 : windowStart;
  const backRange = swapCursor && !stale && oldest > windowStart ? [windowStart, oldest - 1] : null;
  if (!swapCursor || stale || backRange) store.set("pools_oldest_block", String(backRange ? backRange[0] : from));
  const chunk = 2_000;
  const body = async (a: number, b: number) => {
    const [aTs, bTs] = await Promise.all([clock.timestamp(a), clock.timestamp(b)]);
    const tsOf = interpolator(a, aTs, b, bTs);
    // Swaps on the PoolManager plus every Transfer of a graduated Pons token in the same blocks (tokens in batches of 150 addresses per query).
    const tokenList = [...byToken.keys()];
    const transferQueries = [];
    for (let i = 0; i < tokenList.length; i += 150) transferQueries.push(gate.request("eth_getLogs", [{ address: tokenList.slice(i, i + 150), topics: [TRANSFER], fromBlock: hex(a), toBlock: hex(b) }]) as Promise<RawLog[]>);
    const [swapLogs, ...transferChunks] = await Promise.all([
      gate.request("eth_getLogs", [{ address: ADDR.v4PoolManager, topics: [TOPICS.poolSwap], fromBlock: hex(a), toBlock: hex(b) }]) as Promise<RawLog[]>,
      ...transferQueries,
    ]);
    const rows = attributeSwaps({ swapLogs, transferLogs: transferChunks.flat(), pools, hook, launchPair, pairs, ethUsd, tsOf });
    p.unattributed += rows.filter((r) => r.wallet === r.sender).length;
    p.swaps += store.insertSwaps(rows.map(({ sender: _s, ...r }) => r));
  };
  if (backRange && backRange[1] >= backRange[0]) await runChunks(backRange[0], backRange[1], chunk, opts.concurrency ?? 2, body, () => opts.onProgress?.(p));
  await runChunks(from, opts.head, chunk, opts.concurrency ?? 2, body, (b) => { store.setCursor(POOLS_SWAP_CURSOR, b); opts.onProgress?.(p); });
  return p;
}

export interface AttributeInput {
  swapLogs: RawLog[]; transferLogs: RawLog[]; pools: Map<string, PoolRow>; hook: string;
  launchPair: Map<string, string>; pairs: Map<string, { kind: "eth" | "stable" | "stock" | "other"; decimals: number }>; ethUsd: number | null; tsOf: (block: number) => number;
}

/** Pure: Swap logs + token Transfer logs → swap rows with the wallet behind each trade. `sender` is kept for the unattributed count. */
export function attributeSwaps(i: AttributeInput): (SwapRow & { sender: string })[] {
  const PM = ADDR.v4PoolManager.toLowerCase();
  const hook = i.hook.toLowerCase();
  const trBy = new Map<string, { from: string; to: string; value: bigint }[]>();
  for (const l of i.transferLogs) {
    const k = `${l.transactionHash}|${l.address.toLowerCase()}`;
    let arr = trBy.get(k); if (!arr) { arr = []; trBy.set(k, arr); }
    arr.push({ from: "0x" + l.topics[1].slice(-40), to: "0x" + l.topics[2].slice(-40), value: BigInt(l.data) });
  }
  const walletFor = (tx: string, token: string, side: "buy" | "sell"): string | null => {
    const trs = trBy.get(`${tx}|${token}`); if (!trs) return null;
    if (side === "buy") {
      const legs = trs.filter((t) => t.from === PM && t.to !== hook);
      if (!legs.length) return null;
      let hop = legs.reduce((a, b) => (b.value > a.value ? b : a));
      for (let n = 0; n < 6; n++) { const next = trs.find((t) => t.from === hop.to && t.value === hop.value) ?? trs.find((t) => t.from === hop.to && t.to !== hook); if (!next) break; hop = next; }
      return hop.to === hook ? null : hop.to;
    }
    const legs = trs.filter((t) => t.to === PM && t.from !== hook);
    if (!legs.length) return null;
    let hop = legs.reduce((a, b) => (b.value > a.value ? b : a));
    for (let n = 0; n < 6; n++) { const prev = trs.find((t) => t.to === hop.from && t.value === hop.value) ?? trs.find((t) => t.to === hop.from && t.from !== hook); if (!prev) break; hop = prev; }
    return hop.from === hook ? null : hop.from;
  };
  const rows: (SwapRow & { sender: string })[] = [];
  for (const l of i.swapLogs) {
    const s = decodePoolSwap(l); if (!s) continue;
    const pool = i.pools.get(s.poolId); if (!pool) continue;
    const tokenIs0 = pool.currency0 === pool.token;
    const tokenAmt = tokenIs0 ? s.amount0 : s.amount1;
    const quoteAmt = tokenIs0 ? s.amount1 : s.amount0;
    const side = tokenAmt > 0n ? "buy" : "sell";
    const absTok = tokenAmt < 0n ? -tokenAmt : tokenAmt;
    const absQ = quoteAmt < 0n ? -quoteAmt : quoteAmt;
    const wallet = walletFor(l.transactionHash, pool.token, side) ?? s.sender;
    const pairAddr = i.launchPair.get(pool.token) ?? ADDR.zero;
    rows.push({ tx_hash: s.tx_hash, log_index: s.log_index, block: s.block, ts: i.tsOf(s.block), pool_id: s.poolId, token: pool.token, wallet, side, quote_raw: absQ.toString(), tokens_raw: absTok.toString(), quote_norm: normalizeQuote(absQ.toString(), i.pairs.get(pairAddr), i.ethUsd), sender: s.sender });
  }
  return rows;
}
