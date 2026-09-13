import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, words, similarity, normalize } from "../src/analyze/tokenize.ts";

const tags = (i: Parameters<typeof tokenize>[0]) => [...tokenize(i).keys()].sort();

test("splits camelCase, cashtags, digits and drops stop words", () => {
  assert.deepEqual(words("HoodRat2 $GROKTRENCHER"), ["hood", "rat", "groktrencher"]);
  assert.deepEqual(tags({ name: "HoodRat", symbol: "HOODRAT" }), ["hood", "hoodrat", "rat"]);
  assert.equal(tokenize({ symbol: "HOODRAT" }).get("hood"), 1.2);
  assert.equal(tokenize({ symbol: "HOODRAT" }).get("hoodrat"), 0.3);
  assert.deepEqual(tags({ name: "The Official Robinhood Coin", symbol: "OFFICIAL" }), ["hood"]);
  assert.deepEqual(tags({ name: "The Official Coin", symbol: "OFFICIAL" }), []);
});

test("aliases map brand and plural variants to one tag", () => {
  assert.equal(normalize("tesla"), "tsla");
  assert.equal(normalize("frogs"), "frog");
  assert.equal(normalize("agents"), "agent");
  assert.equal(normalize("robinhoodchain"), "hood");
  assert.deepEqual(tags({ name: "Grok Trencher", symbol: "GT" }), ["grok", "gt", "trench"]);
  assert.deepEqual(tags({ symbol: "GROKTRENCHER" }), ["grok", "groktrencher", "trench"]);
});

test("symbol weighs more than name, name more than description; repeats do not stack", () => {
  const t = tokenize({ name: "Astra Hands", symbol: "ASTRA", description: "astra astra astra hands everywhere" });
  assert.equal(t.get("astra"), 1.2);
  assert.equal(t.get("hand"), 1.0);
  assert.equal(t.get("everywhere"), 0.4);
});

test("pair kind becomes a structural tag", () => {
  const t = tokenize({ name: "NVDA Rocket", symbol: "NVDAX", pairKind: "stock" });
  assert.equal(t.get("pair:stock"), 0.6);
  assert.ok(t.has("nvda") && t.has("rocket") && t.has("nvdax"));
});

test("CJK names keep the run and gain translated tags", () => {
  assert.deepEqual(tags({ name: "金狗", symbol: "金狗" }), ["dog", "金狗"]);
  assert.deepEqual(tags({ name: "罗宾侠" }), ["hood", "罗宾侠"]);
  assert.deepEqual(tags({ name: "中国股票指数" }), ["index", "stock", "中国股票指数"]);
  // 金狗 and "Golden Dog" now share a tag
  const a = tokenize({ name: "金狗", symbol: "金狗" }), b = tokenize({ name: "Golden Dog", symbol: "GDOG" });
  assert.ok(a.has("dog") && b.has("dog"));
});

test("similarity is weighted Jaccard", () => {
  const a = tokenize({ name: "Hood Rat", symbol: "HOODRAT" });
  const b = tokenize({ name: "Hood AI", symbol: "HOODAI" });
  const c = tokenize({ name: "Frog Exit", symbol: "FROGX" });
  assert.ok(similarity(a, b) > 0.2 && similarity(a, b) < 0.6, `hood pair sim ${similarity(a, b)}`);
  assert.equal(similarity(a, c), 0);
  assert.equal(similarity(new Map(), a), 0);
});
