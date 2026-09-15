import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoard, readFlow, readTrend, readClusterHistory } from "../src/analyze/readings.ts";

const k = (slug: string, status: "HOT" | "EMERGING" | "ROTATING OUT" | "DEAD", ethIn: number, out = 0, from: string | null = null) => ({ slug, label: slug, status, top_tags: [], n_members: 5, heat: { n_launches: 7, n_members: 5, n_alive: 4, quote_norm_in: ethIn, unique_buyers: 120, n_graduated: 1, graduated_share: 0.1, taxed_ratio: 0.1, pool_volume_norm: 0, delta_pct: 10, pair_mix: { eth: 5, stable: 0, stock: 0, other: 0 } }, links: { text: 3, wallet: 1, deployer: 0, semantic: 0 }, narrative: "animals", narrative_sub: null, narrative_mix: {}, flow: { in_wallets: 0, in_eth: 0, out_wallets: out, out_eth: 0 }, rank: 1, rotating_from: from, rotating_to: null });

test("board reading names the hottest, the drain and the leading narrative", () => {
  const t = readBoard({ window: "60m", counts: { candidates: 1, clustered: 1, trades: 1, launches: 1, sprayers: 0 }, clusters: [k("cat-fart", "HOT", 93.9, 0, "fort-sol"), k("fort-sol", "ROTATING OUT", 5, 225), k("gone", "DEAD", 0)] as never });
  assert.match(t, /1 meta live \(1 hot or rotating in, 0 emerging\) out of 2; 98\.9 ETH/);
  assert.match(t, /Most of it into cat-fart \(animals, 93\.9 ETH, 120 buyers, fed by fort-sol\)/);
  assert.match(t, /Capital is leaving fort-sol: 225 wallets moved to 1 other metas/);
  assert.match(t, /animals holds 100% of the ETH/);
  assert.match(readBoard({ window: "15m", counts: { candidates: 0, clustered: 0, trades: 0, launches: 12, sprayers: 0 }, clusters: [] }), /No live meta in the last 15m: 12 launches/);
});

test("flow and history readings are sentences with the numbers", () => {
  assert.match(readFlow({ window: "60m", nodes: [], edges: [{ from: "fort-sol", to: "cheese", wallets: 34, quote_norm: 2.23, deployers: 7 }, { from: "fort-sol", to: "house", wallets: 27, quote_norm: 1.6, deployers: 0 }] }), /Biggest move: 34 wallets from fort-sol to cheese with 2\.23 ETH\. fort-sol is the main source \(61 wallets out across 2 metas\); cheese is the main destination/);
  assert.match(readFlow({ window: "60m", nodes: [], edges: [] }), /No rotation above the threshold/);
  const rows = [{ ts: "2026-09-13T15:17:00Z", ts_unix: 1, window: "60m", status: "EMERGING", n_launches: 3, quote_eth: 16, buyers: 300, graduations: 0, members: 4 }, { ts: "2026-09-13T15:20:00Z", ts_unix: 2, window: "60m", status: "HOT", n_launches: 3, quote_eth: 94, buyers: 600, graduations: 1, members: 4 }, { ts: "2026-09-13T15:23:00Z", ts_unix: 3, window: "60m", status: "HOT", n_launches: 3, quote_eth: 80, buyers: 600, graduations: 1, members: 4 }];
  assert.match(readClusterHistory("cat-fart", rows, 3), /cat-fart was hot in 67% of 3 snapshots over 3h, peaking at 94\.0 ETH \(15:20 UTC\); it went from emerging to hot/);
  const t = readTrend({ hours: 8, step: 4, since: 0, narratives: ["mixed", "chinese"], rows: [{ from: "2026-09-13T02:00:00Z", from_ts: 0, launches: 1, buys: 1, eth: 500, narratives: { mixed: 30, chinese: 65 } }, { from: "2026-09-13T06:00:00Z", from_ts: 1, launches: 1, buys: 1, eth: 3200, narratives: { mixed: 50, chinese: 25 } }] });
  assert.match(t, /Peak 3200\.0 ETH in the 4h block starting 09-13 06:00 UTC; the latest block did 3200\.0 ETH\. chinese peaked at 65% of ETH \(09-13 02:00\) and is at 25% now\./);
});
