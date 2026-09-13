import { test } from "node:test";
import assert from "node:assert/strict";
import { narrativeOf, tokenNarratives } from "../src/analyze/narrative.ts";
import { tokenize } from "../src/analyze/tokenize.ts";
import type { TokenInfo } from "../src/analyze/types.ts";

const tok = (name: string, symbol: string, pairKind: TokenInfo["pairKind"] = "eth"): TokenInfo => ({ token: name, symbol, name, description: "", pair: "0x0", pairKind, pairSymbol: "ETH", deployer: "d", launchedTs: 0, phase: "curve", graduatedTs: null, tags: tokenize({ name, symbol, pairKind }) });

test("chinese names form the chinese narrative with a sub-narrative from tags", () => {
  const r = narrativeOf([tok("金狗", "金狗"), tok("狗庄", "狗庄"), tok("幸运马", "幸运马"), tok("Golden Dog", "GDOG")]);
  assert.equal(r.narrative, "chinese"); assert.equal(r.sub, "animals"); assert.equal(r.cjk_share, 0.75);
});

test("tag families decide the narrative; nothing dominant is mixed", () => {
  assert.equal(narrativeOf([tok("NVDA Rocket", "NVDAX", "stock"), tok("Tesla Moon", "TSLAM"), tok("Apple Pie", "AAPLP")]).narrative, "stocks");
  assert.equal(narrativeOf([tok("Grok Trencher", "GT"), tok("Claude Agent", "CLAG"), tok("GPT Bot", "GPTB")]).narrative, "ai-agents");
  assert.equal(narrativeOf([tok("Zzyzx", "ZZ"), tok("Qwop", "QW"), tok("Blorp", "BL")]).narrative, "mixed");
  assert.deepEqual(tokenNarratives(tok("Hood Rat", "HOODRAT")).sort(), ["animals", "robinhood"]);
});
