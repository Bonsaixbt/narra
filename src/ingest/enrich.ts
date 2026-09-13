import type { PublicClient, Address } from "viem";
import { factoryAbi, tokenAbi } from "../chain/abi.js";
import { ADDR } from "../chain/constants.js";
import type { Store, TokenRow, PairKind, LaunchRow } from "../store/db.js";

const STABLES = new Set(["USDG", "USDC", "USDT", "USDC.E", "DAI", "USDE"]);

export function pairKind(address: string, symbol: string): PairKind {
  if (address === ADDR.zero) return "eth";
  const s = symbol.toUpperCase();
  if (STABLES.has(s)) return "stable";
  if (/^[A-Z.]{1,6}$/.test(s)) return "stock";
  return "other";
}

/** Fills `tokens` for launches that have no metadata yet: one multicall per batch of tokens, each field fails alone. */
export async function enrichPending(store: Store, http: PublicClient, limit = 200, batch = 25): Promise<{ enriched: number; failed: number }> {
  const pending = store.pendingEnrich(limit);
  let enriched = 0, failed = 0;
  for (let i = 0; i < pending.length; i += batch) {
    const chunk = pending.slice(i, i + batch);
    const contracts = chunk.flatMap((l) => [
      { address: l.token as Address, abi: tokenAbi, functionName: "name" as const },
      { address: l.token as Address, abi: tokenAbi, functionName: "symbol" as const },
      { address: l.token as Address, abi: tokenAbi, functionName: "getTokenInfo" as const },
      { address: ADDR.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken" as const, args: [l.token as Address] },
    ]);
    let results: { status: "success" | "failure"; result?: unknown }[];
    try {
      results = (await http.multicall({ contracts, allowFailure: true })) as typeof results;
    } catch (e) {
      failed += chunk.length;
      const now = Math.floor(Date.now() / 1000);
      store.upsertTokens(chunk.map((l) => emptyToken(l, now, (e as Error).message.slice(0, 120))));
      continue;
    }
    const now = Math.floor(Date.now() / 1000);
    const rows: TokenRow[] = chunk.map((l, j) => {
      const r = results.slice(j * 4, j * 4 + 4);
      const ok = <T,>(k: number): T | null => (r[k]?.status === "success" ? (r[k].result as T) : null);
      const name = ok<string>(0), symbol = ok<string>(1);
      const info = ok<readonly [string, string, string, { twitter: string; telegram: string; discord: string; website: string; farcaster: string }]>(2);
      const rec = ok<{ creatorFeeRecipient: string; creatorTaxBps: number; buybackEnabled: boolean; phase: number; exists: boolean }>(3);
      if (name === null && symbol === null) { failed++; return emptyToken(l, now, "metadata unreadable"); }
      enriched++;
      if (rec?.exists && rec.phase !== l.phase) store.setLifecycle(l.token, { phase: rec.phase });
      return {
        token: l.token, name: name ?? "", symbol: symbol ?? "", description: info?.[2] ?? "", logo: info?.[1] ?? "",
        twitter: info?.[3].twitter ?? "", telegram: info?.[3].telegram ?? "", discord: info?.[3].discord ?? "", website: info?.[3].website ?? "", farcaster: info?.[3].farcaster ?? "",
        creator_fee_recipient: (rec?.creatorFeeRecipient ?? "").toLowerCase(), creator_tax_bps: rec ? Number(rec.creatorTaxBps) : 0, buyback_enabled: rec?.buybackEnabled ? 1 : 0,
        enriched_at: now, error: null,
      };
    });
    store.upsertTokens(rows);
  }
  return { enriched, failed };
}

function emptyToken(l: LaunchRow, now: number, error: string): TokenRow {
  return { token: l.token, name: "", symbol: "", description: "", logo: "", twitter: "", telegram: "", discord: "", website: "", farcaster: "", creator_fee_recipient: "", creator_tax_bps: 0, buyback_enabled: 0, enriched_at: now, error };
}

/** Symbol and decimals for every pair address we have not seen. ETH is address(0). */
export async function ensurePairs(store: Store, http: PublicClient, addresses: string[]): Promise<number> {
  const known = store.pairs();
  const missing = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => !known.has(a));
  let n = 0;
  for (const a of missing) {
    if (a === ADDR.zero) { store.upsertPair({ address: a, symbol: "ETH", decimals: 18, kind: "eth" }); n++; continue; }
    const [sym, dec] = await Promise.all([
      http.readContract({ address: a as Address, abi: tokenAbi, functionName: "symbol" }).catch(() => "?"),
      http.readContract({ address: a as Address, abi: tokenAbi, functionName: "decimals" }).catch(() => 18),
    ]);
    store.upsertPair({ address: a, symbol: sym, decimals: Number(dec), kind: pairKind(a, sym) });
    n++;
  }
  return n;
}

/** quote_norm: ETH pairs in ETH; stables via ETH/USD when known; stock pairs stay null (counted by buyers, not volume). */
export function normalizeQuote(quoteRaw: string, pair: { kind: PairKind; decimals: number } | undefined, ethUsd: number | null): number | null {
  if (!pair) return null;
  const v = Number(BigInt(quoteRaw)) / 10 ** pair.decimals;
  if (pair.kind === "eth") return v;
  if (pair.kind === "stable") return ethUsd ? v / ethUsd : null;
  return null;
}
