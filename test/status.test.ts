import { test } from "node:test";
import assert from "node:assert/strict";
import { statusOf } from "../src/analyze/status.ts";
import type { Heat } from "../src/analyze/types.ts";

const heat = (p: Partial<Heat>): Heat => ({ n_launches: 0, n_members: 5, n_alive: 3, quote_norm_in: 0, unique_buyers: 0, n_graduated: 0, graduated_share: 0, taxed_ratio: 0, pool_volume_norm: 0, delta_pct: null, pair_mix: { eth: 5, stable: 0, stock: 0, other: 0 }, ...p });
const e = (from: string, to: string, wallets: number) => ({ from, to, wallets, quote_norm: 0, deployers: 0 });

test("status table", () => {
  assert.equal(statusOf(heat({ n_launches: 18, quote_norm_in: 2.4, n_graduated: 3 }), [], []), "HOT");
  assert.equal(statusOf(heat({ n_launches: 18, quote_norm_in: 2.4, n_graduated: 3 }), [e("a", "x", 11)], []), "ROTATING IN");
  assert.equal(statusOf(heat({ n_launches: 7, quote_norm_in: 0.8, delta_pct: 150, unique_buyers: 40 }), [], []), "EMERGING");
  assert.equal(statusOf(heat({ n_launches: 22, quote_norm_in: 0.2, delta_pct: -70 }), [], []), "COOLING");
  assert.equal(statusOf(heat({ n_launches: 11, n_alive: 0 }), [], []), "DEAD");
  assert.equal(statusOf(heat({ n_launches: 18, quote_norm_in: 2.4, n_graduated: 3, delta_pct: -10 }), [], [e("x", "b", 9)]), "ROTATING OUT");
});

test("nothing alive is DEAD even for a small cluster", () => {
  assert.equal(statusOf(heat({ n_launches: 1, n_alive: 0 }), [], []), "DEAD");
});

test("a trickle with nothing decisive is COOLING, real money on two live curves is EMERGING", () => {
  assert.equal(statusOf(heat({ n_launches: 0, n_alive: 2, quote_norm_in: 0.004, unique_buyers: 3 }), [], []), "COOLING");
  assert.equal(statusOf(heat({ n_launches: 0, n_alive: 2, quote_norm_in: 0.5, unique_buyers: 12 }), [], []), "EMERGING");
});
