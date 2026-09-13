/** Raw eth_getLogs entries → typed rows. Pure functions, no network. */
import { decodeEventLog, type Hex } from "viem";
import { curveAbi, factoryAbi, poolManagerAbi } from "../chain/abi.js";
import { TOPICS } from "../chain/topics.js";
import type { LaunchRow, TradeRow } from "../store/db.js";

export interface RawLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  blockHash?: Hex;
  removed?: boolean;
}

export const hexToNum = (h: Hex | string): number => Number(BigInt(h));

export interface LifecycleEvent {
  kind: "swept" | "graduated";
  token: string;
  block: number;
  positionId?: string;
}

export function decodeLaunch(log: RawLog, ts: number): LaunchRow | null {
  if (log.topics[0]?.toLowerCase() !== TOPICS.tokenLaunched.toLowerCase()) return null;
  const { args } = decodeEventLog({ abi: factoryAbi, eventName: "TokenLaunched", topics: log.topics as [Hex, ...Hex[]], data: log.data });
  return {
    token: args.token.toLowerCase(),
    curve: args.curve.toLowerCase(),
    deployer: args.deployer.toLowerCase(),
    pair: args.pairToken.toLowerCase(),
    launch_config_id: Number(args.launchConfigId),
    graduation_threshold: args.graduationThreshold.toString(),
    block: hexToNum(log.blockNumber),
    tx_hash: log.transactionHash,
    log_index: hexToNum(log.logIndex),
    ts,
    phase: 0, swept_at: null, graduated_at: null, position_id: null, pool_id: null,
  };
}

export function decodeLifecycle(log: RawLog): LifecycleEvent | null {
  const t = log.topics[0]?.toLowerCase();
  if (t === TOPICS.launchSwept.toLowerCase()) {
    const { args } = decodeEventLog({ abi: factoryAbi, eventName: "LaunchSwept", topics: log.topics as [Hex, ...Hex[]], data: log.data });
    return { kind: "swept", token: args.token.toLowerCase(), block: hexToNum(log.blockNumber) };
  }
  if (t === TOPICS.poolGraduated.toLowerCase()) {
    const { args } = decodeEventLog({ abi: factoryAbi, eventName: "PoolGraduated", topics: log.topics as [Hex, ...Hex[]], data: log.data });
    return { kind: "graduated", token: args.token.toLowerCase(), block: hexToNum(log.blockNumber), positionId: args.positionId.toString() };
  }
  return null;
}

export function decodeTrade(log: RawLog, ts: number): TradeRow | null {
  const t = log.topics[0]?.toLowerCase();
  const base = { block: hexToNum(log.blockNumber), tx_hash: log.transactionHash, log_index: hexToNum(log.logIndex), ts, curve: log.address.toLowerCase(), token: null, quote_norm: null };
  if (t === TOPICS.curveBuy.toLowerCase()) {
    const { args } = decodeEventLog({ abi: curveAbi, eventName: "CurveBuy", topics: log.topics as [Hex, ...Hex[]], data: log.data });
    return { ...base, side: "buy", actor: args.buyer.toLowerCase(), recipient: args.recipient.toLowerCase(), quote_raw: args.quoteIn.toString(), tokens_raw: args.tokensOut.toString(), fee_raw: args.fee.toString(), tax_raw: args.tax.toString() };
  }
  if (t === TOPICS.curveSell.toLowerCase()) {
    const { args } = decodeEventLog({ abi: curveAbi, eventName: "CurveSell", topics: log.topics as [Hex, ...Hex[]], data: log.data });
    return { ...base, side: "sell", actor: args.seller.toLowerCase(), recipient: args.recipient.toLowerCase(), quote_raw: args.quoteOut.toString(), tokens_raw: args.tokensIn.toString(), fee_raw: args.fee.toString(), tax_raw: args.tax.toString() };
  }
  return null;
}

export interface PoolInit { poolId: string; currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string; block: number }
export interface PoolSwap { poolId: string; sender: string; amount0: bigint; amount1: bigint; block: number; tx_hash: string; log_index: number }

export function decodePoolInit(log: RawLog): PoolInit | null {
  if (log.topics[0]?.toLowerCase() !== TOPICS.poolInitialize.toLowerCase()) return null;
  const { args } = decodeEventLog({ abi: poolManagerAbi, eventName: "Initialize", topics: log.topics as [Hex, ...Hex[]], data: log.data });
  return { poolId: args.id.toLowerCase(), currency0: args.currency0.toLowerCase(), currency1: args.currency1.toLowerCase(), fee: args.fee, tickSpacing: args.tickSpacing, hooks: args.hooks.toLowerCase(), block: hexToNum(log.blockNumber) };
}

export function decodePoolSwap(log: RawLog): PoolSwap | null {
  if (log.topics[0]?.toLowerCase() !== TOPICS.poolSwap.toLowerCase()) return null;
  const { args } = decodeEventLog({ abi: poolManagerAbi, eventName: "Swap", topics: log.topics as [Hex, ...Hex[]], data: log.data });
  return { poolId: args.id.toLowerCase(), sender: args.sender.toLowerCase(), amount0: args.amount0, amount1: args.amount1, block: hexToNum(log.blockNumber), tx_hash: log.transactionHash, log_index: hexToNum(log.logIndex) };
}

/** Linear timestamp interpolation inside a block chunk: two block reads instead of thousands. */
export function interpolator(fromBlock: number, fromTs: number, toBlock: number, toTs: number): (block: number) => number {
  if (toBlock <= fromBlock) return () => toTs;
  const rate = (toTs - fromTs) / (toBlock - fromBlock);
  return (block: number) => Math.round(fromTs + (block - fromBlock) * rate);
}
