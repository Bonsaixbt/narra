/** Holder gate: read a public balance, hand back a short HMAC token. No signature, no wallet software. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseAbi, type Address, type PublicClient } from "viem";
import { CONFIG } from "./config.js";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

export async function readBalance(http: PublicClient, token: string, address: string): Promise<{ balance: number; decimals: number }> {
  const [raw, dec] = await Promise.all([
    http.readContract({ address: token as Address, abi: erc20, functionName: "balanceOf", args: [address as Address] }),
    http.readContract({ address: token as Address, abi: erc20, functionName: "decimals" }).catch(() => 18),
  ]);
  return { balance: Number(raw) / 10 ** Number(dec), decimals: Number(dec) };
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueToken(address: string, balance: number, secret = CONFIG.holderSecret, ttl = CONFIG.holderTtlSec, now = Date.now()): string {
  const payload = b64(JSON.stringify({ a: address.toLowerCase(), b: Math.floor(balance), e: Math.floor(now / 1000) + ttl }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token: string | undefined, secret = CONFIG.holderSecret, now = Date.now()): { address: string; balance: number; exp: number } | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString()) as { a: string; b: number; e: number };
    if (j.e * 1000 < now) return null;
    return { address: j.a, balance: j.b, exp: j.e };
  } catch { return null; }
}
