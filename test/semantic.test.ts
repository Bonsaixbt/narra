import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store/db.ts";
import { ensureEmbeddings, semanticPairs, nameCluster, budgetLeft, type SemanticState } from "../src/semantic/index.ts";
import { parseNaming, semanticConfig } from "../src/semantic/provider.ts";
import { buildClusters } from "../src/analyze/cluster.ts";
import { tokenize } from "../src/analyze/tokenize.ts";
import type { TokenInfo } from "../src/analyze/types.ts";

const tok = (i: number, name: string, symbol: string): TokenInfo => ({ token: `0xt${i}`, symbol, name, description: "", pair: "0x0", pairKind: "eth", pairSymbol: "ETH", deployer: `0xd${i}`, launchedTs: 1000, phase: "curve", graduatedTs: null, tags: tokenize({ name, symbol, pairKind: "eth" }) });

/** A fake embedder: identical vectors for names in the same "concept" bucket, orthogonal otherwise. */
function fakeState(threshold = 0.86): SemanticState {
  const bucket = (t: string) => (/dog|hound|狗/i.test(t) ? 0 : /cat|kitty|猫/i.test(t) ? 1 : 2);
  return {
    cfg: { ...semanticConfig({ NARRA_SEMANTIC: "on", NARRA_SEMANTIC_NAME: "off" }), threshold, budgetPerDay: 2 },
    embedder: { model: "fake", dim: 3, async embed(texts) { return texts.map((t) => { const v = new Float32Array(3); v[bucket(t)] = 1; return v; }); } },
    namer: { model: "fake-namer", async name(i) { return { label: `named-${i.slug}`, summary: `${i.members.length} members about ${i.tags[0] ?? "nothing"}` }; } },
    errors: [],
  };
}

test("embeddings are cached once and semantic pairs link same-meaning names across languages", async () => {
  const store = new Store(":memory:");
  const st = fakeState();
  const tokens = [tok(1, "Golden Hound", "GHOUND"), tok(2, "金狗", "金狗"), tok(3, "Kitty Cat", "KITTY"), tok(4, "Quantum Banana", "QBAN")];
  assert.equal(await ensureEmbeddings(store, st, tokens), 4);
  assert.equal(await ensureEmbeddings(store, st, tokens), 0);
  const pairs = semanticPairs(store, st, tokens);
  assert.deepEqual(pairs.map(([a, b]) => [tokens[a].symbol, tokens[b].symbol]), [["GHOUND", "金狗"]]);
  // without semantic links these two never meet (no shared tag: the CJK dictionary maps 狗 → dog, hound is not dog)
  const plain = buildClusters([...tokens, tok(5, "Golden Retriever", "GRET"), tok(6, "Gold Bar", "GBAR")], new Map(), { minTagSupport: 2, simThreshold: 0.35, minBuyerOverlap: 5, minBuyerShare: 0.2, minWalletPairsToMerge: 2, minSize: 2, maxSize: 60, semanticSplitFloor: 0.9, maxTokensPerWallet: 60 });
  const withSem = buildClusters([...tokens, tok(5, "Golden Retriever", "GRET"), tok(6, "Gold Bar", "GBAR")], new Map(), { minTagSupport: 2, simThreshold: 0.35, minBuyerOverlap: 5, minBuyerShare: 0.2, minWalletPairsToMerge: 2, minSize: 2, maxSize: 60, semanticSplitFloor: 0.9, maxTokensPerWallet: 60 }, 4, pairs);
  const has = (cl: ReturnType<typeof buildClusters>, a: string, b: string) => cl.some((c) => c.members.includes(a) && c.members.includes(b));
  assert.equal(has(plain, "0xt1", "0xt2"), false);
  assert.equal(has(withSem, "0xt1", "0xt2"), true);
  assert.equal(withSem.find((c) => c.members.includes("0xt1"))?.links.semantic, 1);
});

test("cluster naming is cached by member key and stops at the daily budget", async () => {
  const store = new Store(":memory:");
  const st = fakeState();
  const input = { slug: "dog", tags: ["dog"], members: [{ symbol: "A", name: "A", description: "" }], heat: { n_launches: 1, quote_norm_in: 1, unique_buyers: 1 } };
  const a = await nameCluster(store, st, input, "k1");
  assert.deepEqual(a, { label: "named-dog", summary: "1 members about dog", source: "model" });
  assert.equal((await nameCluster(store, st, input, "k1"))?.source, "cache");
  assert.equal(budgetLeft(store, st), 1);
  await nameCluster(store, st, input, "k2");
  assert.equal(budgetLeft(store, st), 0);
  assert.equal(await nameCluster(store, st, input, "k3"), null);
});

test("naming output is parsed defensively", () => {
  assert.deepEqual(parseNaming('Sure! {"label": "Stock Memes!!", "summary": "riding  the HOOD listing"}', "x"), { label: "stock-memes", summary: "riding the HOOD listing" });
  assert.deepEqual(parseNaming("garbage", "fallback"), { label: "fallback", summary: "" });
  assert.equal(semanticConfig({}).enabled, false);
  assert.equal(semanticConfig({ NARRA_SEMANTIC: "on" }).embed, "local");
});

test("categories come from the nearest anchor with a margin and never link tokens on their own", async () => {
  const { applyCategories } = await import("../src/semantic/taxonomy.ts");
  const store = new Store(":memory:");
  const anchors = new Map<string, Float32Array[]>([["animal", [Float32Array.from([1, 0, 0])]], ["stock", [Float32Array.from([0, 1, 0])]]]);
  const a = tok(1, "Alpha", "AAA"), b = tok(2, "Beta", "BBB"), c = tok(3, "Gamma", "CCC");
  store.putEmbeddings([{ token: a.token, model: "m", vec: Float32Array.from([0.9, 0.1, 0]) }, { token: b.token, model: "m", vec: Float32Array.from([0.1, 0.9, 0]) }, { token: c.token, model: "m", vec: Float32Array.from([0.5, 0.5, 0]) }]);
  assert.equal(applyCategories(store, "m", anchors, [a, b, c]), 2);
  assert.equal(a.tags.get("cat:animal"), 0.8); assert.equal(b.tags.get("cat:stock"), 0.8); assert.equal(c.tags.has("cat:animal") || c.tags.has("cat:stock"), false);
  const d = tok(4, "Delta", "DDD"), e = tok(5, "Epsilon", "EEE"), f = tok(6, "Zeta", "ZZZ");
  for (const t of [d, e, f]) t.tags.set("cat:animal", 0.8);
  const cl = buildClusters([d, e, f], new Map(), { minTagSupport: 2, simThreshold: 0.3, minBuyerOverlap: 5, minBuyerShare: 0.2, minWalletPairsToMerge: 2, minSize: 2, maxSize: 60, semanticSplitFloor: 0.9, maxTokensPerWallet: 60 });
  assert.equal(cl.length, 0, "a shared category alone must not form a cluster");
});
