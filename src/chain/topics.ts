import { toEventSelector, type Hex } from "viem";

const SIG = {
  tokenLaunched: "TokenLaunched(address,address,address,address,uint256,uint256)",
  launchSwept: "LaunchSwept(address,uint256,uint256)",
  poolGraduated: "PoolGraduated(address,uint256,uint256,uint256)",
  curveBuy: "CurveBuy(address,address,uint256,uint256,uint256,uint256)",
  curveSell: "CurveSell(address,address,uint256,uint256,uint256,uint256)",
  poolInitialize: "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
  poolSwap: "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
} as const;

export const TOPICS: Record<keyof typeof SIG, Hex> = Object.fromEntries(
  Object.entries(SIG).map(([k, sig]) => [k, toEventSelector(sig)]),
) as Record<keyof typeof SIG, Hex>;

/** Hashes observed on chain. If the computed selectors drift from these, the ABI above is wrong. */
export const KNOWN_TOPICS = {
  tokenLaunched: "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607",
  curveBuy: "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
  curveSell: "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df",
} as const;

export function assertTopics(): void {
  for (const [k, v] of Object.entries(KNOWN_TOPICS)) {
    const computed = TOPICS[k as keyof typeof KNOWN_TOPICS];
    if (computed.toLowerCase() !== v) throw new Error(`topic mismatch for ${k}: computed ${computed}, expected ${v}`);
  }
}
