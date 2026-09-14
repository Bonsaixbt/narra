import { loadEnv } from "narra-cli";
loadEnv();
const num = (k: string, d: number) => Number(process.env[k] ?? d);
export const CONFIG = {
  port: num("NARRA_API_PORT", 4663),
  host: process.env.NARRA_API_HOST ?? "0.0.0.0",
  origin: process.env.NARRA_API_ORIGIN ?? "",               // CORS: the site's origin; empty = any (dev)
  tokenAddress: (process.env.NARRA_TOKEN_ADDRESS ?? "").toLowerCase(),
  holderThreshold: num("NARRA_HOLDER_THRESHOLD", 500_000),   // whole tokens
  holderSecret: process.env.NARRA_HOLDER_SECRET ?? "",
  holderTtlSec: num("NARRA_HOLDER_TTL_S", 86_400),
  rateAnon: num("NARRA_RATE_ANON", 60),                      // requests per minute per IP
  rateHolder: num("NARRA_RATE_HOLDER", 600),
  publicStreamDelaySec: num("NARRA_PUBLIC_STREAM_DELAY_S", 300),
  tickSec: num("NARRA_TICK_S", 30),
  windows: ((process.env.NARRA_WINDOWS ?? "60m,15m,4h").split(",").map((s) => s.trim()) as ("15m" | "60m" | "4h")[]),
  slowWindowEverySec: num("NARRA_SLOW_WINDOW_EVERY_S", 300), // 4h is expensive; recompute at most this often
  trendEverySec: num("NARRA_TREND_EVERY_S", 900),           // /api/trend is precomputed in the worker this often
  staleAfterSec: num("NARRA_STALE_AFTER_S", 180),
  maxLagBlocks: num("NARRA_MAX_LAG_BLOCKS", 300),
};
/** Before the token exists every gate is open. */
export const gateEnabled = () => !!CONFIG.tokenAddress && !!CONFIG.holderSecret;
