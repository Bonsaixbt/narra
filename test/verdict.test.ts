import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictFor } from "../src/analyze/verdict.ts";
import { tokenize } from "../src/analyze/tokenize.ts";
import { centroidOf } from "../src/analyze/cluster.ts";
import type { ClusterOut, TokenInfo } from "../src/analyze/types.ts";
import type { TradeRow } from "../src/store/db.ts";

const tok = (token: string, name: string, symbol: string): TokenInfo => ({ token, symbol, name, description: "", pair: "0x0", pairKind: "eth", pairSymbol: "ETH", deployer: "0xd", launchedTs: 1000, phase: "curve", graduatedTs: null, tags: tokenize({ name, symbol, pairKind: "eth" }) });
const buy = (token: string, recipient: string, ts: number): TradeRow => ({ tx_hash: `${token}${recipient}`, log_index: 0, block: 1, ts, curve: "c", token, side: "buy", actor: recipient, recipient, quote_raw: "1", tokens_raw: "1", fee_raw: "0", tax_raw: "0", quote_norm: 0.1 });
const heat = { n_launches: 18, n_members: 3, n_alive: 3, quote_norm_in: 2.4, unique_buyers: 50, n_graduated: 3, graduated_share: 0, taxed_ratio: 0.1, pool_volume_norm: 0, delta_pct: 40, pair_mix: { eth: 3, stable: 0, stock: 0, other: 0 } };

function ctx(status: ClusterOut["status"]) {
  const members = [tok("m1", "Hood AI", "HOODAI"), tok("m2", "Hood Cat", "HOODCAT"), tok("m3", "Hood Dog", "HOODDOG")];
  const cluster: ClusterOut = { slug: "hood", label: "hood", status, top_tags: [{ tag: "hood", weight: 1.1 }], members: members.map((m) => m.token), heat, rotating_from: null, rotating_to: null };
  const tokens = new Map(members.map((m) => [m.token, m]));
  const buyers = new Map<string, Set<string>>();
  for (const m of members) buyers.set(m.token, new Set(Array.from({ length: 20 }, (_, i) => `w${i}`)));
  return { clusters: [cluster], centroids: new Map([["hood", centroidOf(members.map((m) => m.tags))]]), membership: new Map(members.map((m) => [m.token, "hood"])), buyers, tokens, window: { from: 0, to: 2000 } };
}

test("matching words plus overlapping early buyers → IN with numbered reasons", () => {
  const t = tok("x", "Hood Rat", "HOODRAT");
  const trades = Array.from({ length: 30 }, (_, i) => buy("x", `w${i}`, 1500)); // w0..w19 overlap, w20..w29 fresh
  const v = verdictFor(t, trades, ctx("HOT"));
  assert.equal(v.verdict, "IN");
  assert.equal(v.cluster?.slug, "hood");
  assert.ok(v.reasons.some((r) => /20\/30 early buyers/.test(r)), v.reasons.join(" | "));
  assert.ok(v.reasons.some((r) => /matches cluster tags hood/.test(r)));
});

test("a token whose cluster is dead is OUT; a stranger is ORPHAN", () => {
  const t = tok("x", "Hood Rat", "HOODRAT");
  const trades = Array.from({ length: 30 }, (_, i) => buy("x", `w${i}`, 1500));
  assert.equal(verdictFor(t, trades, ctx("DEAD")).verdict, "OUT");
  const stranger = tok("y", "Quantum Banana", "QBAN");
  const v = verdictFor(stranger, [buy("y", "zz", 1500)], ctx("HOT"));
  assert.equal(v.verdict, "ORPHAN");
  assert.equal(v.cluster, null);
});

test("words fit but buyers do not → EDGE", () => {
  const t = tok("x", "Hood Rat", "HOODRAT");
  const trades = Array.from({ length: 30 }, (_, i) => buy("x", `fresh${i}`, 1500));
  const v = verdictFor(t, trades, ctx("HOT"));
  assert.equal(v.verdict, "EDGE");
  assert.ok(v.reasons.some((r) => /below 0.5/.test(r)));
});

test("a name match with a single overlapping buyer is EDGE, not IN", () => {
  const t = tok("x", "Hood Rat", "HOODRAT");
  const trades = [buy("x", "w0", 1500), buy("x", "fresh1", 1500), buy("x", "fresh2", 1500)];
  const v = verdictFor(t, trades, ctx("HOT"));
  assert.equal(v.verdict, "EDGE");
  assert.ok(v.reasons.some((r) => /only 1 early buyer overlap/.test(r)), v.reasons.join(" | "));
});
