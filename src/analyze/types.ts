import type { PairKind } from "../store/db.js";
import type { Tags } from "./tokenize.js";

export type Status = "HOT" | "EMERGING" | "ROTATING IN" | "ROTATING OUT" | "COOLING" | "DEAD";
export type VerdictKind = "IN" | "EDGE" | "OUT" | "ORPHAN" | "NOISE" | "NOT_PONS";
export type PhaseName = "curve" | "swept" | "pool" | "rescued";

export interface TokenInfo {
  token: string; symbol: string; name: string; description: string;
  pair: string; pairKind: PairKind; pairSymbol: string; deployer: string;
  launchedTs: number; phase: PhaseName; graduatedTs: number | null;
  tags: Tags;
}

export interface Heat {
  n_launches: number;
  n_members: number;
  n_alive: number;
  quote_norm_in: number;
  unique_buyers: number;
  n_graduated: number;
  graduated_share: number;
  /** share of buys inside the first 5 s after launch (bots) — the field keeps its name for schema stability */
  taxed_ratio: number;
  pool_volume_norm: number;
  delta_pct: number | null;
  pair_mix: { eth: number; stable: number; stock: number; other: number };
}

export interface Edge { from: string; to: string; wallets: number; quote_norm: number; deployers: number }

export interface ClusterOut {
  slug: string; label: string; status: Status;
  top_tags: { tag: string; weight: number }[];
  members: string[];
  heat: Heat;
  links: { text: number; wallet: number; deployer: number; semantic: number };
  summary?: string;
  label_source?: "tags" | "model" | "cache";
  cohorts?: { sniper: number; sprayer: number; rotator: number; "early-in-hot": number; total: number };
  rotating_from: string | null; rotating_to: string | null;
}

export interface MemberOut {
  token: string; symbol: string; name: string; phase: PhaseName;
  curve_progress: number | null; membership: number; buyers_overlap: number; last_trade_ts: number | null; launched_ts: number;
}

export interface VerdictOut {
  token: string; symbol: string; name: string; phase: PhaseName;
  curve: { real_quote_eth: number | null; threshold_eth: number; progress: number | null } | null;
  pool: { graduated_at: number; volume_eth_window: number; swaps_window: number } | null;
  pair: { address: string; symbol: string; kind: PairKind };
  launched_at: number; deployer: string;
  verdict: VerdictKind;
  cluster: { slug: string; status: Status; membership: number } | null;
  alternatives: { slug: string; membership: number }[];
  reasons: string[]; watch: string[];
  evidence: { early_buyers: number; overlap_buyers: number; text_score: number; wallet_score: number; launch_tx: string | null; launch_block: number | null };
}
