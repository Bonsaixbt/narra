import { test } from "node:test";
import assert from "node:assert/strict";
import { walletStats, cohortMix } from "../src/analyze/wallets.ts";
import type { TradeRow, LaunchRow } from "../src/store/db.ts";

const launch = (token: string, ts: number): LaunchRow => ({ token, curve: "c" + token, deployer: "d", pair: "0x0", launch_config_id: 0, graduation_threshold: "1", block: 1, tx_hash: "h", log_index: 0, ts, phase: 0, swept_at: null, graduated_at: null, position_id: null, pool_id: null });
const tr = (w: string, token: string, side: "buy" | "sell", ts: number, q: number, taxed = false): TradeRow => ({ tx_hash: `${w}${token}${side}${ts}`, log_index: 0, block: 1, ts, curve: "c" + token, token, side, actor: w, recipient: w, quote_raw: "1", tokens_raw: "1", fee_raw: "0", tax_raw: taxed ? "9" : "0", quote_norm: q });

test("cohorts: sniper, rotator, early-in-hot, sprayer", () => {
  const launches = new Map([["a", launch("a", 1000)], ["b", launch("b", 1000)], ["c", launch("c", 1000)], ["d", launch("d", 1000)]]);
  const membership = new Map([["a", "x"], ["b", "y"], ["c", "z"], ["d", "z"]]);
  const statuses = new Map([["x", "HOT" as const], ["y", "EMERGING" as const], ["z", "DEAD" as const]]);
  const trades: TradeRow[] = [
    // sniper: three buys within 5 s of launch
    tr("snipe", "a", "buy", 1001, 0.1), tr("snipe", "b", "buy", 1001, 0.1), tr("snipe", "c", "buy", 1002, 0.1),
    // rotator: three clusters, net positive
    tr("rot", "a", "buy", 1100, 0.1), tr("rot", "b", "buy", 1200, 0.1), tr("rot", "c", "buy", 1300, 0.1), tr("rot", "a", "sell", 1400, 0.5),
    // early-in-hot needs 3 live-cluster buys within 300 s: a (HOT), b (EMERGING) twice
    tr("early", "a", "buy", 1050, 0.1), tr("early", "b", "buy", 1060, 0.1), tr("early", "b", "buy", 1070, 0.1),
    // sprayer: 4 tokens over a cap of 3
    tr("spray", "a", "buy", 2000, 0.01), tr("spray", "b", "buy", 2000, 0.01), tr("spray", "c", "buy", 2000, 0.01), tr("spray", "d", "buy", 2000, 0.01),
  ];
  const st = walletStats({ trades, swaps: [], launches, membership, statuses, window: { from: 0, to: 5000 }, sprayerCap: 3 });
  assert.deepEqual(st.get("snipe")?.cohorts, ["sniper"]);
  assert.deepEqual(st.get("rot")?.cohorts, ["rotator"]);
  assert.equal(st.get("rot")?.net_eth, 0.2);
  assert.deepEqual(st.get("early")?.cohorts, ["early-in-hot"]);
  assert.deepEqual(st.get("spray")?.cohorts, ["sprayer"]);
  assert.equal(st.get("snipe")?.median_entry_sec, 1);
  const mix = cohortMix(["snipe", "rot", "nobody"], st);
  assert.equal(mix.total, 2); assert.equal(mix.sniper, 1); assert.equal(mix.rotator, 1);
});
