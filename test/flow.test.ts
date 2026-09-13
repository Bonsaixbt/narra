import { test } from "node:test";
import assert from "node:assert/strict";
import { flowEdges } from "../src/analyze/flow.ts";
import type { TradeRow } from "../src/store/db.ts";

const buy = (token: string, recipient: string, ts: number): TradeRow => ({ tx_hash: `${token}${recipient}${ts}`, log_index: 0, block: 1, ts, curve: "c", token, side: "buy", actor: recipient, recipient, quote_raw: "1", tokens_raw: "1", fee_raw: "0", tax_raw: "0", quote_norm: 0.1 });

test("wallets that sat in A last window and buy B now form an A→B edge", () => {
  const membership = new Map([["a1", "frog"], ["a2", "frog"], ["b1", "hood"]]);
  const trades: TradeRow[] = [];
  for (let w = 0; w < 6; w++) { trades.push(buy("a1", `w${w}`, 100), buy("a2", `w${w}`, 150), buy("b1", `w${w}`, 1200)); }
  trades.push(buy("a1", "single", 100), buy("b1", "single", 1200)); // bought only one A token: not "in" A
  const edges = flowEdges(membership, trades, [], { from: 1000, to: 2000 });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, "frog"); assert.equal(edges[0].to, "hood"); assert.equal(edges[0].wallets, 6);
  assert.equal(edges[0].quote_norm, 0.6);
});

test("edges below the wallet threshold are dropped unless deployers carry them", () => {
  const membership = new Map([["a1", "frog"], ["a2", "frog"], ["b1", "hood"]]);
  const trades = [buy("a1", "w", 100), buy("a2", "w", 100), buy("b1", "w", 1500)];
  assert.equal(flowEdges(membership, trades, [], { from: 1000, to: 2000 }).length, 0);
  const launch = (token: string, deployer: string, ts: number) => ({ token, curve: "c" + token, deployer, pair: "0x0", launch_config_id: 0, graduation_threshold: "1", block: 1, tx_hash: "h" + token, log_index: 0, ts, phase: 0, swept_at: null, graduated_at: null, position_id: null, pool_id: null });
  const launches = [launch("a1", "d1", 100), launch("b1", "d1", 1500), launch("a2", "d2", 100), launch("b1", "d2", 1600)];
  const edges = flowEdges(membership, trades, launches, { from: 1000, to: 2000 });
  assert.equal(edges.length, 1); assert.equal(edges[0].deployers, 2);
});
