/** Flow history: one sampled tick per step, ticks recomputed when the flow tables predate them, and meta ids that survive ticks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store/db.ts";
import { sampleTicks, flowHistory, backfillFlowHistory } from "../src/analyze/flowHistory.ts";

test("sampleTicks picks the last tick inside each step and null for empty steps", () => {
  const since = 1000, step = 100;
  const ticks = [1010, 1050, 1090, 1150, 1310, 1390];
  assert.deepEqual(sampleTicks(ticks, since, step, 4), [1090, 1150, null, 1390]);
});

test("flowHistory serves stored edges per sampled tick and reports nodes with ids", () => {
  const s = new Store(":memory:");
  const now = 100_000;
  for (const ts of [now - 3000, now - 1800, now - 600]) {
    s.saveSnapshots([{ slug: "a", window: "60m", ts, status: "HOT", payload: JSON.stringify({ members: ["0x1", "0x2"] }), meta_id: "a@1", first_seen: 1 }, { slug: "b", window: "60m", ts, status: "EMERGING", payload: JSON.stringify({ members: ["0x3"] }), meta_id: "b@2", first_seen: 2 }]);
    s.saveFlowSnapshot("60m", ts, ts === now - 600 ? [{ from: "a", to: "b", wallets: 7, quote_norm: 1.2345, deployers: 0 }] : []);
  }
  const h = flowHistory(s, "60m", 1, "15m", now);
  assert.equal(h.slots.length, 4);
  assert.equal(h.backfilled, 0, "ticks with flow rows are not recomputed");
  assert.deepEqual(h.slots.map((x) => x.ts), [now - 3000, null, now - 1800, now - 600]);
  const last = h.slots[3];
  assert.deepEqual(last.edges, [{ from: "a", to: "b", wallets: 7, eth: 1.235, deployers: 0 }]);
  assert.deepEqual(last.nodes.map((n) => [n.slug, n.id, n.first_seen_ts]), [["a", "a@1", 1], ["b", "b@2", 2]]);
  assert.equal(h.slots[2].edges.length, 0, "a tick with no edges stays empty, not missing");
  assert.equal(h.slots[1].nodes.length, 0, "an empty step has no nodes either");
  s.close();
});

test("backfill recomputes ticks that have snapshots but no flow row, from stored trades", () => {
  const s = new Store(":memory:");
  const now = 200_000, from = now - 3600;
  const launch = (token: string, deployer: string, curve: string, ts: number, block: number) => ({ token, curve, deployer, pair: "0x0", launch_config_id: 0, graduation_threshold: "0", block, tx_hash: `0xl${token}`, log_index: 0, ts, phase: 0, swept_at: null, graduated_at: null, position_id: null, pool_id: null });
  s.upsertLaunches([launch("0xa1", "0xd1", "0xc1", from - 7000, 1), launch("0xa2", "0xd1", "0xc2", from - 7000, 1), launch("0xb1", "0xd2", "0xc3", from + 10, 2)]);
  // six wallets buy two A tokens in the previous window and B in this one → an a→b edge above the 5-wallet floor
  const trade = (curve: string, token: string, w: string, ts: number, tx: string) => ({ tx_hash: tx, log_index: 0, block: 3, ts, curve, token, side: "buy" as const, actor: w, recipient: w, quote_raw: "1", tokens_raw: "1", fee_raw: "0", tax_raw: "0", quote_norm: 0.1 });
  const trades = [];
  for (let i = 0; i < 6; i++) {
    const w = `0xw${i}`;
    trades.push(trade("0xc1", "0xa1", w, from - 3000 + i, `0xt${i}a`), trade("0xc2", "0xa2", w, from - 2000 + i, `0xt${i}b`), trade("0xc3", "0xb1", w, from + 100 + i, `0xt${i}c`));
  }
  s.insertTrades(trades);
  s.saveSnapshots([{ slug: "a", window: "60m", ts: now, status: "COOLING", payload: JSON.stringify({ members: ["0xa1", "0xa2"] }) }, { slug: "b", window: "60m", ts: now, status: "HOT", payload: JSON.stringify({ members: ["0xb1"] }) }]);
  assert.equal(backfillFlowHistory(s, "60m", [now]), 1);
  const edges = s.flowEdgesAt("60m", now);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from_slug, "a"); assert.equal(edges[0].to_slug, "b"); assert.equal(edges[0].wallets, 6);
  assert.equal(backfillFlowHistory(s, "60m", [now]), 0, "second pass finds the tick row and does nothing");
  s.close();
});

