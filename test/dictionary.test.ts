import { test } from "node:test";
import assert from "node:assert/strict";
import { unmatchedTags } from "../src/cli/dictionary.ts";

test("unmatched words are ranked by ETH, need three tokens, and skip known families and CJK", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => ({ name: `Ponsora ${i}`, symbol: `PONS${i}`, description: "", eth: 10 })),
    ...Array.from({ length: 3 }, (_, i) => ({ name: `Cheese ${i}`, symbol: `CHZ${i}`, description: "", eth: 1 })),
    { name: "Lonely", symbol: "LON", description: "", eth: 100 },
    ...Array.from({ length: 3 }, (_, i) => ({ name: `Dog ${i}`, symbol: `DOG${i}`, description: "", eth: 50 })),
    ...Array.from({ length: 3 }, (_, i) => ({ name: "金狗", symbol: "金狗", description: "", eth: 50 })),
  ];
  const c = unmatchedTags(rows);
  const tags = c.map((x) => x.tag);
  assert.equal(tags[0], "ponsora");
  assert.ok(tags.includes("cheese"));
  for (const bad of ["dog", "金狗", "lonely"]) assert.ok(!tags.includes(bad), `${bad} should be excluded`);
  assert.equal(c[0].tokens, 4); assert.equal(c[0].eth, 40);
});
