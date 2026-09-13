import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, type LaunchRow, type TradeRow } from "../src/store/db.ts";

const launch = (i: number, ts: number): LaunchRow => ({
  token: `0xT${i}`.padEnd(42, "0"), curve: `0xC${i}`.padEnd(42, "0"), deployer: "0xD".padEnd(42, "0"), pair: "0x".padEnd(42, "0"),
  launch_config_id: 0, graduation_threshold: "4200000000000000000", block: 100 + i, tx_hash: `0xh${i}`, log_index: 0, ts,
  phase: 0, swept_at: null, graduated_at: null, position_id: null, pool_id: null,
});
const trade = (tx: string, idx: number, curve: string, ts: number, recipient = "0xw1"): TradeRow => ({
  tx_hash: tx, log_index: idx, block: 200, ts, curve, token: null, side: "buy", actor: recipient, recipient,
  quote_raw: "1000", tokens_raw: "5", fee_raw: "10", tax_raw: "0", quote_norm: null,
});

test("launches upsert is idempotent and case-insensitive", () => {
  const s = new Store(":memory:");
  assert.equal(s.upsertLaunches([launch(1, 10), launch(2, 20)]), 2);
  assert.equal(s.upsertLaunches([{ ...launch(1, 10), token: launch(1, 10).token.toUpperCase() }]), 0);
  assert.equal(s.launchesSince(15).length, 1);
  assert.ok(s.launch(launch(2, 20).token.toUpperCase()));
});

test("trades dedupe on (tx_hash, log_index) and resolve tokens via launches", () => {
  const s = new Store(":memory:");
  s.upsertLaunches([launch(1, 10)]);
  const c = launch(1, 10).curve;
  assert.equal(s.insertTrades([trade("0xa", 0, c, 11), trade("0xa", 0, c, 11), trade("0xa", 1, "0xunknown", 12)]), 2);
  assert.deepEqual(s.unknownCurves(0), [c.toLowerCase(), "0xunknown"]);
  assert.equal(s.resolveTradeTokens(), 1);
  assert.deepEqual(s.unknownCurves(0), ["0xunknown"]);
  assert.equal(s.tradesForToken(c === launch(1, 10).curve ? launch(1, 10).token : "")[0]?.token, launch(1, 10).token.toLowerCase());
});

test("cursors, kv, lifecycle and prune", () => {
  const s = new Store(":memory:");
  s.setCursor("launches", 500, "0xabc");
  assert.deepEqual(s.getCursor("launches"), { last_block: 500, last_block_hash: "0xabc" });
  s.set("eth_usd", "4000");
  assert.equal(s.get("eth_usd"), "4000");
  s.upsertLaunches([launch(1, 10)]);
  s.setLifecycle(launch(1, 10).token, { phase: 2, graduated_at: 99 });
  assert.equal(s.launch(launch(1, 10).token)?.phase, 2);
  s.insertTrades([trade("0xa", 0, "0xc", 1000), trade("0xb", 0, "0xc", 5000)]);
  assert.deepEqual(s.prune(1, 5000 + 3600 - 1), { trades: 1, swaps: 0 });
  assert.equal(s.stats().trades, 1);
});

test("pendingEnrich lists launches without token rows", () => {
  const s = new Store(":memory:");
  s.upsertLaunches([launch(1, 10), launch(2, 20)]);
  s.upsertTokens([{ token: launch(1, 10).token, name: "A", symbol: "A", description: "", logo: "", twitter: "", telegram: "", discord: "", website: "", farcaster: "", creator_fee_recipient: "", creator_tax_bps: 0, buyback_enabled: 0, enriched_at: 1, error: null }]);
  assert.deepEqual(s.pendingEnrich(10).map((l) => l.token), [launch(2, 20).token.toLowerCase()]);
});
