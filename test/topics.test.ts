import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS, KNOWN_TOPICS, assertTopics } from "../src/chain/topics.ts";

test("computed event selectors match the hashes observed on chain", () => {
  assert.equal(TOPICS.tokenLaunched.toLowerCase(), KNOWN_TOPICS.tokenLaunched);
  assert.equal(TOPICS.curveBuy.toLowerCase(), KNOWN_TOPICS.curveBuy);
  assert.equal(TOPICS.curveSell.toLowerCase(), KNOWN_TOPICS.curveSell);
  assert.doesNotThrow(assertTopics);
});

test("pool manager selectors are 32-byte hex", () => {
  for (const k of ["poolInitialize", "poolSwap", "launchSwept", "poolGraduated"] as const) {
    assert.match(TOPICS[k], /^0x[0-9a-f]{64}$/i);
  }
});
