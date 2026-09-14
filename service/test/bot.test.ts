import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, formatDigest, formatCoin, digestSignature, CommunityBot } from "../src/bot.ts";
import type { NowOut, CoinOut } from "narra-cli";

const cluster = (slug: string, status: NowOut["clusters"][number]["status"], ethIn: number, out = 0): NowOut["clusters"][number] => ({ slug, label: slug, status, top_tags: [], n_members: 5, heat: { n_launches: 7, n_members: 5, n_alive: 4, quote_norm_in: ethIn, unique_buyers: 120, n_graduated: 1, graduated_share: 0.1, taxed_ratio: 0.1, pool_volume_norm: 0, delta_pct: 10, pair_mix: { eth: 5, stable: 0, stock: 0, other: 0 } }, links: { text: 3, wallet: 1, deployer: 0, semantic: 0 }, narrative: "animals", narrative_sub: null, narrative_mix: {}, flow: { in_wallets: 0, in_eth: 0, out_wallets: out, out_eth: 0 }, rank: 1, rotating_from: null, rotating_to: null });
const board: NowOut = { schema_version: "1.0.0", computed_at: "", window: "60m", window_from: 0, window_to: 0, head_block: 1, lag_blocks: 0, source: { rpc: "x", mode: "cache" }, quote_unit: "ETH", counts: { candidates: 10, clustered: 5, trades: 100, launches: 20, sprayers: 1 }, clusters: [cluster("cat-fart", "HOT", 93.9), cluster("fort-sol", "ROTATING OUT", 5, 225), cluster("gone", "DEAD", 0)] };

test("commands parse with and without the bot suffix; a bare address means /coin", () => {
  assert.deepEqual(parseCommand("/meta@narra_bot 15m"), { cmd: "meta", arg: "15m" });
  assert.deepEqual(parseCommand("/coin 0x" + "a".repeat(40)), { cmd: "coin", arg: "0x" + "a".repeat(40) });
  assert.deepEqual(parseCommand("0x" + "b".repeat(40)), { cmd: "coin", arg: "0x" + "b".repeat(40) });
  assert.equal(parseCommand("hello"), null);
});

test("digest is short, skips DEAD, names the hottest and the draining meta", () => {
  const t = formatDigest(board);
  assert.ok(t.includes("hottest  <b>cat-fart</b>"));
  assert.ok(t.includes("draining <b>fort-sol</b> — 225 wallets left"));
  assert.ok(!t.includes("gone"));
  assert.ok(t.split("\n").length <= 14);
});

test("coin card keeps verdict, meta, popularity, two reasons and one watch-out, and escapes html", () => {
  const r: CoinOut = { schema_version: "1.0.0", computed_at: "", window: "60m", window_from: 0, window_to: 0, head_block: 1, lag_blocks: 0, source: { rpc: "x", mode: "cache" }, token: "0xabc", symbol: "S<UP", name: "Soup", phase: "curve", curve: { real_quote_eth: 1, threshold_eth: 4.2, progress: 0.2 }, pool: null, pair: { address: "0x0", symbol: "ETH", kind: "eth" }, launched_at: 0, deployer: "0x", verdict: "IN", cluster: { slug: "soup", status: "HOT", membership: 0.8 }, alternatives: [], reasons: ["a", "b", "c", "popularity: x"], watch: ["w1", "w2"], reading: "In a live meta.", activity: { buys_10m: 3, buyers_10m: 3, buys_60m: 20, buyers_60m: 15, sells_60m: 2, eth_in_60m: 1.5, last_trade_ts: 1, first_trade_ts: 0 }, early_cohorts: { sniper: 1, sprayer: 0, rotator: 2, "early-in-hot": 3, total: 10 }, deployer_launches_window: 1, nearest: [{ slug: "soup", status: "HOT", membership: 0.8, overlap: 5 }], words: ["soup"], narratives: [], popularity: { cluster_rank: 1, clusters_total: 9, rank_in_cluster: 2, cluster_size: 5, buyers: 50, buyers_percentile: 90 }, evidence: { early_buyers: 1, overlap_buyers: 1, text_score: 1, wallet_score: 1, launch_tx: null, launch_block: null } };
  const t = formatCoin(r);
  assert.ok(t.includes("$S&lt;UP") && t.includes("<b>IN</b> — soup 0.80 · hot") && t.includes("meta #1 of 9") && t.includes("3 buys · 3 buyers in 10m") && t.includes("\n· a") && t.includes("\n· b") && !t.includes("\n· c") && t.includes("⚠ w1") && t.includes("⚠ w2"), t);
  assert.ok(t.split("\n\n").length >= 4, "sections separated by blank lines");
});

test("bot answers commands through the api, ignores chats outside the allow-list, rate-limits per user", async () => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, init?: RequestInit) => { if (init?.body) sent.push(JSON.parse(String(init.body)).text); return { ok: true, json: async () => ({ ok: true, result: [] }) } as unknown as Response; }) as typeof fetch;
  const bot = new CommunityBot({ token: "t", communityChats: [], digestEverySec: 9999, commands: true, allowedChats: new Set(["1"]) }, { now: async () => board, coin: async () => null, why: async () => null, find: async () => null, flow: async () => null, trend: async () => null }, fetchFn);
  await bot.handle({ message: { text: "/meta", chat: { id: 1 }, from: { id: 7 } } });
  await bot.handle({ message: { text: "/meta", chat: { id: 2 }, from: { id: 7 } } });
  assert.equal(sent.length, 1); assert.ok(sent[0].includes("cat-fart"));
  for (let i = 0; i < 12; i++) await bot.handle({ message: { text: "/help", chat: { id: 1 }, from: { id: 9 } } });
  assert.equal(sent.length, 1 + 10);
});


test("digest posts on change and at the hard max gap, not every interval", async () => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, init?: RequestInit) => { if (init?.body) sent.push(JSON.parse(String(init.body)).text); return { ok: true, json: async () => ({ ok: true, result: [] }) } as unknown as Response; }) as typeof fetch;
  let current = board;
  const bot = new CommunityBot({ token: "t", communityChats: ["c"], digestEverySec: 1800, commands: true, allowedChats: null }, { now: async () => current, coin: async () => null, why: async () => null, find: async () => null, flow: async () => null, trend: async () => null }, fetchFn);
  assert.equal(await bot.digest(0), true);
  assert.equal(await bot.digest(1800_000), false);                          // nothing changed
  current = { ...board, clusters: [board.clusters[1], board.clusters[0], board.clusters[2]] };
  assert.notEqual(digestSignature(current), digestSignature(board));
  assert.equal(await bot.digest(3600_000), true);                           // changed
  assert.equal(await bot.digest(3600_000 + 4 * 1800_000), true);           // hard max gap reached
  assert.equal(sent.length, 3);
});

test("/coin takes up to three addresses in one message", async () => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, init?: RequestInit) => { if (init?.body) sent.push(JSON.parse(String(init.body)).text); return { ok: true } as Response; }) as typeof fetch;
  let calls = 0;
  const bot = new CommunityBot({ token: "t", communityChats: [], digestEverySec: 1, commands: true, allowedChats: null }, { now: async () => board, coin: async () => { calls++; return null; }, why: async () => null, find: async () => null, flow: async () => null, trend: async () => null }, fetchFn);
  await bot.handle({ message: { text: `/coin 0x${"1".repeat(40)} 0x${"2".repeat(40)} 0x${"3".repeat(40)} 0x${"4".repeat(40)}`, chat: { id: 1, type: "group" }, from: { id: 1 }, message_id: 5 } });
  assert.equal(calls, 3);
  assert.equal(sent.length, 1);
});
