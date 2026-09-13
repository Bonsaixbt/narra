/** Output schemas. One source of truth for --json, the library, MCP and `narra schema`. */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";

const Meta = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  computed_at: z.string(),
  window: z.enum(["15m", "60m", "4h"]),
  window_from: z.number(),
  window_to: z.number(),
  head_block: z.number().nullable(),
  lag_blocks: z.number().nullable(),
  source: z.object({ rpc: z.string(), mode: z.enum(["cold", "cache", "live"]) }),
});

export const Status = z.enum(["HOT", "EMERGING", "ROTATING IN", "ROTATING OUT", "COOLING", "DEAD"]);
export const Verdict = z.enum(["IN", "EDGE", "OUT", "ORPHAN", "NOISE", "NOT_PONS"]);
export const Phase = z.enum(["curve", "swept", "pool", "rescued"]);
export const PairKind = z.enum(["eth", "stable", "stock", "other"]);

export const Heat = z.object({
  n_launches: z.number(), n_members: z.number(), n_alive: z.number(), quote_norm_in: z.number(), unique_buyers: z.number(),
  n_graduated: z.number(), graduated_share: z.number(), taxed_ratio: z.number(), pool_volume_norm: z.number(), delta_pct: z.number().nullable(),
  pair_mix: z.object({ eth: z.number(), stable: z.number(), stock: z.number(), other: z.number() }),
});
export const Edge = z.object({ from: z.string(), to: z.string(), wallets: z.number(), quote_norm: z.number(), deployers: z.number() });
export const Member = z.object({
  token: z.string(), symbol: z.string(), name: z.string(), phase: Phase, curve_progress: z.number().nullable(),
  membership: z.number(), buyers_overlap: z.number(), last_trade_ts: z.number().nullable(), launched_ts: z.number(),
});
export const Cluster = z.object({
  slug: z.string(), label: z.string(), status: Status, top_tags: z.array(z.object({ tag: z.string(), weight: z.number() })),
  n_members: z.number(), heat: Heat, links: z.object({ text: z.number(), wallet: z.number(), deployer: z.number(), semantic: z.number() }),
  summary: z.string().optional(), label_source: z.enum(["tags", "model", "cache"]).optional(),
  narrative: z.string(), narrative_sub: z.string().nullable(), narrative_mix: z.record(z.string(), z.number()),
  flow: z.object({ in_wallets: z.number(), in_eth: z.number(), out_wallets: z.number(), out_eth: z.number() }), rank: z.number(),
  cohorts: z.object({ sniper: z.number(), sprayer: z.number(), rotator: z.number(), "early-in-hot": z.number(), total: z.number() }).optional(), rotating_from: z.string().nullable(), rotating_to: z.string().nullable(),
  members: z.array(Member).optional(),
});

export const NowOut = Meta.extend({
  quote_unit: z.literal("ETH"),
  clusters: z.array(Cluster),
  counts: z.object({ candidates: z.number(), clustered: z.number(), trades: z.number(), launches: z.number(), sprayers: z.number() }),
});
export const CoinOut = Meta.extend({
  token: z.string(), symbol: z.string(), name: z.string(), phase: Phase,
  curve: z.object({ real_quote_eth: z.number().nullable(), threshold_eth: z.number(), progress: z.number().nullable() }).nullable(),
  pool: z.object({ graduated_at: z.number(), volume_eth_window: z.number(), swaps_window: z.number() }).nullable(),
  pair: z.object({ address: z.string(), symbol: z.string(), kind: PairKind }),
  launched_at: z.number(), deployer: z.string(),
  verdict: Verdict,
  cluster: z.object({ slug: z.string(), status: Status, membership: z.number() }).nullable(),
  alternatives: z.array(z.object({ slug: z.string(), membership: z.number() })),
  reasons: z.array(z.string()), watch: z.array(z.string()),
  narratives: z.array(z.string()),
  popularity: z.object({ cluster_rank: z.number().nullable(), clusters_total: z.number(), rank_in_cluster: z.number().nullable(), cluster_size: z.number().nullable(), buyers: z.number(), buyers_percentile: z.number() }).nullable(),
  evidence: z.object({ early_buyers: z.number(), overlap_buyers: z.number(), text_score: z.number(), wallet_score: z.number(), launch_tx: z.string().nullable(), launch_block: z.number().nullable() }),
});
export const NotPonsOut = Meta.extend({ token: z.string(), verdict: z.literal("NOT_PONS"), reasons: z.array(z.string()) });
export const FlowOut = Meta.extend({ nodes: z.array(z.object({ slug: z.string(), status: Status })), edges: z.array(Edge) });
export const WhyOut = Meta.extend({
  cluster: Cluster, tags: z.array(z.object({ tag: z.string(), weight: z.number(), examples: z.array(z.string()) })),
  edges_in: z.array(Edge), edges_out: z.array(Edge), rule: z.string(),
});
export const WatchEvent = z.object({
  schema_version: z.literal(SCHEMA_VERSION), ts: z.string(),
  type: z.enum(["LAUNCH", "STATUS", "EDGE", "GRAD", "JOIN", "SYNC"]),
  slug: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
  token: z.string().optional(), symbol: z.string().optional(), wallets: z.number().optional(), note: z.string().optional(),
});

export const Cohort = z.enum(["sniper", "sprayer", "rotator", "early-in-hot"]);
export const WalletStat = z.object({
  wallet: z.string(), buys: z.number(), sells: z.number(), tokens: z.number(), quote_in: z.number(), quote_out: z.number(), net_eth: z.number(),
  closed_tokens: z.number(), wins: z.number(), fast_share: z.number(), median_entry_sec: z.number().nullable(), clusters: z.array(z.string()), cohorts: z.array(Cohort), last_ts: z.number(),
});
export const WalletsOut = Meta.extend({ cohort: Cohort.nullable(), sort: z.enum(["net_eth", "tokens", "buys", "quote_in"]), wallets: z.array(WalletStat), counts: z.object({ wallets: z.number(), sniper: z.number(), sprayer: z.number(), rotator: z.number(), "early-in-hot": z.number() }) });
export const WalletOut = Meta.extend({
  wallet: z.string(), stat: WalletStat.nullable(),
  positions: z.array(z.object({ token: z.string(), symbol: z.string(), cluster: z.string().nullable(), status: Status.nullable(), venue: z.enum(["curve", "pool", "both"]), buys: z.number(), sells: z.number(), quote_in: z.number(), quote_out: z.number(), first_buy_after_launch_sec: z.number().nullable(), last_ts: z.number() })),
  note: z.string(),
});
export const SCHEMAS = { now: NowOut, coin: CoinOut, flow: FlowOut, why: WhyOut, watch: WatchEvent, wallets: WalletsOut, wallet: WalletOut } as const;
export type NowOut = z.infer<typeof NowOut>;
export type CoinOut = z.infer<typeof CoinOut>;
export type NotPonsOut = z.infer<typeof NotPonsOut>;
export type FlowOut = z.infer<typeof FlowOut>;
export type WhyOut = z.infer<typeof WhyOut>;
export type WatchEvent = z.infer<typeof WatchEvent>;
export type WalletsOut = z.infer<typeof WalletsOut>;
export type WalletOut = z.infer<typeof WalletOut>;

export function jsonSchema(name: keyof typeof SCHEMAS): unknown { return z.toJSONSchema(SCHEMAS[name]); }
