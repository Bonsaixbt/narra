/**
 * Public facts about Robinhood Chain and the Pons v2 launchpad.
 * Everything here is verifiable on the explorer or by reading the live factory;
 * `narra doctor` re-checks the protocol parameters against the chain at runtime.
 */
import { defineChain, type Address } from "viem";

export const CHAIN = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address } },
});

export const ADDR = {
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address,
  v4PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address,
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
  zero: "0x0000000000000000000000000000000000000000" as Address,
} as const;

/** Protocol parameters we expect to find on the live factory (config id 0). */
export const PROTOCOL = {
  supply: 1_000_000_000n * 10n ** 18n,
  graduationThresholdEth: 4.2,
  phantomQuoteEth: 1.68,
  snipeTaxStartBps: 9_900n,
  snipeTaxSeconds: 3n,
  /** Observed block cadence; used only as a first estimate before timestamps are read. */
  approxBlockMs: 100,
} as const;

export interface EndpointSpec {
  url: string;
  /** Serves eth_getLogs. */
  logs: boolean;
  label: string;
  /** Max in-flight requests to this endpoint. */
  concurrency: number;
}

export const DEFAULT_ENDPOINTS: EndpointSpec[] = [
  { url: "https://robinhood-rpc.publicnode.com", logs: false, label: "publicnode", concurrency: 3 },
  { url: "https://rpc.mainnet.chain.robinhood.com", logs: true, label: "robinhood", concurrency: 2 },
];

export const DEFAULT_WS = "wss://robinhood-rpc.publicnode.com";

export const EXPLORER = {
  tx: (h: string) => `https://robinhoodchain.blockscout.com/tx/${h}`,
  address: (a: string) => `https://robinhoodchain.blockscout.com/address/${a}`,
  token: (a: string) => `https://robinhoodchain.blockscout.com/token/${a}`,
  pons: (a: string) => `https://www.ponsfamily.com/launchpad/${a}`,
};

export const PHASE = ["curve", "swept", "pool", "rescued"] as const;
export type Phase = (typeof PHASE)[number];
