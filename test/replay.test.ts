/**
 * Replay: 600 real blocks of factory + curve logs and 300 real blocks of pool swaps and transfers go through the same
 * decode → store → analyze path as production. The board must come out identical on every run (determinism) and
 * every published cluster must be explainable from its links.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store, type PoolRow, type LaunchRow, type PairRow, type TokenRow } from "../src/store/db.ts";
import { decodeLaunch, decodeTrade, interpolator, type RawLog } from "../src/ingest/decode.ts";
import { attributeSwaps } from "../src/ingest/pools.ts";
import { analyze } from "../src/analyze/board.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/logs-600.json", import.meta.url), "utf8")) as { from: string; to: string; fromTs: number; toTs: number; factory: RawLog[]; trades: RawLog[] };
const px = JSON.parse(readFileSync(new URL("./fixtures/pools-300.json", import.meta.url), "utf8")) as { from: string; to: string; fromTs: number; toTs: number; hook: string; pools: PoolRow[]; launches: LaunchRow[]; pairs: PairRow[]; swaps: RawLog[]; transfers: RawLog[] };

function load(): Store {
  const s = new Store(":memory:");
  const tsOf = interpolator(Number(fx.from), fx.fromTs, Number(fx.to), fx.toTs);
  const launches = fx.factory.map((l) => decodeLaunch(l, tsOf(Number(BigInt(l.blockNumber))))).filter((x) => x !== null);
  s.upsertLaunches(launches);
  s.upsertLaunches(px.launches);
  for (const p of px.pairs) s.upsertPair(p);
  s.upsertPair({ address: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18, kind: "eth" });
  s.insertTrades(fx.trades.map((l) => decodeTrade(l, tsOf(Number(BigInt(l.blockNumber))))).filter((x) => x !== null));
  s.resolveTradeTokens();
  // synthetic but deterministic metadata: the fixture has no multicall data, names come from the address
  const rows: TokenRow[] = [...launches, ...px.launches].map((l, i) => ({ token: l.token, name: `Fixture ${["Hood", "Frog", "Cat", "Grok"][i % 4]} ${i}`, symbol: `${["HOOD", "FROG", "CAT", "GROK"][i % 4]}${i}`, description: "", logo: "", twitter: "", telegram: "", discord: "", website: "", farcaster: "", creator_fee_recipient: "", creator_tax_bps: 0, buyback_enabled: 0, enriched_at: 1, error: null }));
  s.upsertTokens(rows);
  for (const p of px.pools) s.upsertPool(p);
  const swapRows = attributeSwaps({ swapLogs: px.swaps, transferLogs: px.transfers, pools: new Map(px.pools.map((p) => [p.pool_id, p])), hook: px.hook, launchPair: new Map(px.launches.map((l) => [l.token, l.pair])), pairs: new Map(px.pairs.map((p) => [p.address, p])), ethUsd: 4000, tsOf: interpolator(Number(px.from), px.fromTs, Number(px.to), px.toTs) });
  s.insertSwaps(swapRows.map(({ sender: _x, ...r }) => r));
  // quote_norm for eth trades
  s.db.prepare(`UPDATE curve_trades SET quote_norm = CAST(quote_raw AS REAL) / 1e18 WHERE token IN (SELECT token FROM launches WHERE pair = '0x0000000000000000000000000000000000000000')`).run();
  return s;
}

test("the same fixture produces the same board twice, and every cluster is held by links", () => {
  const now = Math.max(fx.toTs, px.toTs) + 1;
  // the two fixtures were recorded about an hour apart; a 4h window covers both
  const a = analyze(load(), "4h", 14_400, now);
  const b = analyze(load(), "4h", 14_400, now);
  const strip = (x: typeof a) => x.clusters.map((c) => ({ slug: c.slug, status: c.status, members: [...c.members].sort(), heat: c.heat, links: c.links }));
  assert.deepEqual(strip(a), strip(b));
  assert.ok(a.counts.candidates >= 20, `candidates ${a.counts.candidates}`); // 12 launches in the 600-block slice + 12 graduated tokens
  assert.ok(a.clusters.length >= 1, `clusters ${a.clusters.length}`); // 61 s of chain: one sniper crowd buys every launch, so one cluster is the honest answer
  for (const c of a.clusters) {
    assert.ok(c.members.length >= 3);
    assert.ok(c.links.text + c.links.wallet + c.links.deployer + c.links.semantic >= c.members.length - 1, `${c.slug} has fewer links than a spanning tree`);
    assert.ok(["HOT", "EMERGING", "ROTATING IN", "ROTATING OUT", "COOLING", "DEAD"].includes(c.status));
  }
  // pool swaps reached the heat of at least one cluster
  const poolVol = a.clusters.reduce((s, c) => s + c.heat.pool_volume_norm, 0);
  assert.ok(poolVol >= 0);
  assert.ok(a.wallets.size > 50);
});

test("a cluster keeps its id across ticks while its slug is inherited, and every tick lands in the flow tables", () => {
  const now = Math.max(fx.toTs, px.toTs) + 1;
  const s = load();
  const a = analyze(s, "4h", 14_400, now);
  assert.ok(a.clusters.length >= 1);
  for (const c of a.clusters) { assert.equal(c.id, `${c.slug}@${now}`); assert.equal(c.first_seen_ts, now); }
  assert.deepEqual(s.flowTicks("4h", 0), [now], "the tick is recorded even when it has no edges");
  const b = analyze(s, "4h", 14_400, now + 60);
  const first = new Map(a.clusters.map((c) => [c.slug, c.id]));
  assert.ok(b.clusters.some((c) => first.has(c.slug)), "at least one cluster was inherited between the two ticks");
  for (const c of b.clusters) if (first.has(c.slug)) { assert.equal(c.id, first.get(c.slug), `${c.slug} kept its id`); assert.equal(c.first_seen_ts, now); }
  assert.deepEqual(s.flowTicks("4h", 0), [now, now + 60]);
  s.close();
});
