import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLaunch, decodeLifecycle, decodeTrade, interpolator, type RawLog } from "../src/ingest/decode.ts";
import { Store } from "../src/store/db.ts";
import { pairKind, normalizeQuote } from "../src/ingest/enrich.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/logs-600.json", import.meta.url), "utf8")) as { from: string; to: string; fromTs: number; toTs: number; factory: RawLog[]; trades: RawLog[] };
const tsOf = interpolator(Number(fx.from), fx.fromTs, Number(fx.to), fx.toTs);

test("recorded factory logs decode into launches with sane fields", () => {
  const launches = fx.factory.map((l) => decodeLaunch(l, tsOf(Number(BigInt(l.blockNumber))))).filter((x) => x !== null);
  assert.ok(launches.length >= 5, `expected launches in fixture, got ${launches.length}`);
  for (const L of launches) {
    assert.match(L.token, /^0x[0-9a-f]{40}$/);
    assert.match(L.curve, /^0x[0-9a-f]{40}$/);
    assert.notEqual(L.token, L.curve);
    if (L.pair === "0x0000000000000000000000000000000000000000") assert.equal(L.graduation_threshold, "4200000000000000000");
    else assert.ok(BigInt(L.graduation_threshold) > 0n);
    assert.ok(L.ts >= fx.fromTs && L.ts <= fx.toTs);
  }
  // Non-launch factory logs either decode as lifecycle or are ignored, never throw.
  for (const l of fx.factory) decodeLifecycle(l);
});

test("recorded curve logs decode into buys and sells and load into the store", () => {
  const trades = fx.trades.map((l) => decodeTrade(l, tsOf(Number(BigInt(l.blockNumber))))).filter((x) => x !== null);
  assert.equal(trades.length, fx.trades.length);
  const buys = trades.filter((t) => t.side === "buy"), sells = trades.filter((t) => t.side === "sell");
  assert.ok(buys.length > 0 && sells.length > 0);
  for (const t of buys) assert.ok(BigInt(t.quote_raw) > 0n && BigInt(t.tokens_raw) > 0n);
  const s = new Store(":memory:");
  assert.equal(s.insertTrades(trades), trades.length);
  assert.equal(s.insertTrades(trades), 0);
  const launches = fx.factory.map((l) => decodeLaunch(l, 0)).filter((x) => x !== null);
  s.upsertLaunches(launches);
  const resolved = s.resolveTradeTokens();
  assert.ok(resolved > 0, "some trades in the fixture belong to launches in the same 600 blocks");
});

test("interpolator is linear and clamps a degenerate chunk", () => {
  const f = interpolator(100, 1000, 200, 1010);
  assert.equal(f(100), 1000); assert.equal(f(150), 1005); assert.equal(f(200), 1010);
  assert.equal(interpolator(5, 7, 5, 9)(5), 9);
});

test("pair kinds and quote normalisation", () => {
  assert.equal(pairKind("0x0000000000000000000000000000000000000000", "ETH"), "eth");
  assert.equal(pairKind("0xabc", "USDG"), "stable");
  assert.equal(pairKind("0xabc", "NVDA"), "stock");
  assert.equal(pairKind("0xabc", "Wrapped Something"), "other");
  assert.equal(normalizeQuote("1500000000000000000", { kind: "eth", decimals: 18 }, null), 1.5);
  assert.equal(normalizeQuote("4000000000", { kind: "stable", decimals: 6 }, 4000), 1);
  assert.equal(normalizeQuote("4000000000", { kind: "stable", decimals: 6 }, null), null);
  assert.equal(normalizeQuote("1", { kind: "stock", decimals: 18 }, 4000), null);
});
