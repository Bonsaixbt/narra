import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attributeSwaps } from "../src/ingest/pools.ts";
import { interpolator, type RawLog } from "../src/ingest/decode.ts";
import type { PoolRow, LaunchRow, PairRow } from "../src/store/db.ts";
import { Store } from "../src/store/db.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/pools-300.json", import.meta.url), "utf8")) as { from: string; to: string; fromTs: number; toTs: number; hook: string; pools: PoolRow[]; launches: LaunchRow[]; pairs: PairRow[]; swaps: RawLog[]; transfers: RawLog[] };

test("recorded pool swaps get a side, a quote and a wallet that is neither the hook nor (mostly) the router", () => {
  const pools = new Map(fx.pools.map((p) => [p.pool_id, p]));
  const rows = attributeSwaps({
    swapLogs: fx.swaps, transferLogs: fx.transfers, pools, hook: fx.hook,
    launchPair: new Map(fx.launches.map((l) => [l.token, l.pair])), pairs: new Map(fx.pairs.map((p) => [p.address, p])), ethUsd: 4000,
    tsOf: interpolator(Number(fx.from), fx.fromTs, Number(fx.to), fx.toTs),
  });
  assert.ok(rows.length > 100, `expected swaps for known pools, got ${rows.length}`);
  const buys = rows.filter((r) => r.side === "buy"), sells = rows.filter((r) => r.side === "sell");
  assert.ok(buys.length > 0 && sells.length > 0);
  // the hook itself swaps (buybacks); only then may the wallet be the hook
  for (const r of rows) { assert.ok(BigInt(r.quote_raw) > 0n && BigInt(r.tokens_raw) > 0n); if (r.wallet === fx.hook) assert.equal(r.sender, fx.hook); }
  const attributed = rows.filter((r) => r.wallet !== r.sender).length / rows.length;
  assert.ok(attributed > 0.9, `attributed share ${attributed}`);
  const buyWallets = new Set(buys.map((b) => b.wallet)).size, sellWallets = new Set(sells.map((b) => b.wallet)).size;
  assert.ok(buyWallets > buys.length / 10 && sellWallets > sells.length / 10, `wallet diversity buys ${buyWallets}/${buys.length} sells ${sellWallets}/${sells.length}`);
  const s = new Store(":memory:");
  assert.equal(s.insertSwaps(rows.map(({ sender: _x, ...r }) => r)), rows.length);
});

test("prune folds old rows into hourly aggregates before deleting them", () => {
  const s = new Store(":memory:");
  s.upsertLaunches([{ token: "0xt", curve: "0xc", deployer: "0xd", pair: "0x0", launch_config_id: 0, graduation_threshold: "1", block: 1, tx_hash: "h", log_index: 0, ts: 0, phase: 0, swept_at: null, graduated_at: null, position_id: null, pool_id: null }]);
  const mk = (i: number, side: "buy" | "sell", ts: number) => ({ tx_hash: "t" + i, log_index: 0, block: 1, ts, curve: "0xc", token: "0xt", side, actor: "w" + i, recipient: "w" + (i % 3), quote_raw: "1", tokens_raw: "1", fee_raw: "0", tax_raw: i % 2 ? "5" : "0", quote_norm: 0.5 });
  s.insertTrades([mk(1, "buy", 100), mk(2, "buy", 200), mk(3, "sell", 300), mk(4, "buy", 7200 + 10)]);
  const r = s.prune(1, 7200 + 3600 + 1); // cutoff = 7201: first three rows are older
  assert.equal(r.trades, 3);
  const h = s.hourlyFor(["0xt"], 0);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].buys, h[0].sells, h[0].quote_in, h[0].quote_out, h[0].unique_buyers, h[0].taxed], [2, 1, 1, 0.5, 2, 1]);
  assert.equal(s.stats().trades, 1);
});
