import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClusters, inheritSlugs, buyersByToken } from "../src/analyze/cluster.ts";
import { tokenize } from "../src/analyze/tokenize.ts";
import type { TokenInfo } from "../src/analyze/types.ts";

const tok = (i: number, name: string, symbol: string, deployer = `0xd${i}`): TokenInfo => ({
  token: `0xt${i}`, symbol, name, description: "", pair: "0x0", pairKind: "eth", pairSymbol: "ETH", deployer, launchedTs: 1000 + i, phase: "curve", graduatedTs: null,
  tags: tokenize({ name, symbol, pairKind: "eth" }),
});

test("tokens sharing supported tags form one cluster; unrelated names stay apart", () => {
  const tokens = [
    tok(1, "Hood Rat", "HOODRAT"), tok(2, "Hood AI", "HOODAI"), tok(3, "Hood Cat", "HOODCAT"), tok(4, "Robinhood Dog", "HOODDOG"),
    tok(5, "Frog Exit", "FROGX"), tok(6, "Frog King", "FROGK"), tok(7, "Pepe Frog", "PEPE"),
    tok(8, "Lonely Whale", "WHALE"),
  ];
  const cl = buildClusters(tokens, new Map(), { minTagSupport: 3, simThreshold: 0.3, minBuyerOverlap: 5, minBuyerShare: 0.15, minWalletPairsToMerge: 2, minSize: 3, maxTokensPerWallet: 60 });
  assert.equal(cl.length, 2);
  const slugs = cl.map((c) => c.slug).sort();
  assert.ok(slugs[0].includes("frog") && slugs[1].includes("hood"), slugs.join(","));
  const hood = cl.find((c) => c.slug.includes("hood"))!;
  assert.equal(hood.members.length, 4);
  for (const m of hood.members) assert.ok((hood.membership.get(m) ?? 0) > 0.3);
});

test("shared buyers link tokens with unrelated names", () => {
  const tokens = [tok(1, "Alpha One", "AAA"), tok(2, "Beta Two", "BBB"), tok(3, "Gamma Three", "CCC"), tok(4, "Delta Four", "DDD")];
  const trades = [] as { token: string; side: string; recipient: string }[];
  for (let w = 0; w < 6; w++) for (const t of ["0xt1", "0xt2", "0xt3"]) trades.push({ token: t, side: "buy", recipient: `0xw${w}` });
  const cl = buildClusters(tokens, buyersByToken(trades));
  assert.equal(cl.length, 1);
  assert.deepEqual(cl[0].members.sort(), ["0xt1", "0xt2", "0xt3"]);
});

test("same deployer plus a shared tag links; a wallet that buys everything does not vote", () => {
  const tokens = [tok(1, "Astra Hands", "ASTRA", "0xdev"), tok(2, "Astra Feet", "ASTRAF", "0xdev"), tok(3, "Astra Eyes", "ASTRAE", "0xdev"), tok(4, "Zebra", "ZZZ"), tok(5, "Yak", "YYY"), tok(6, "Xylo", "XXX")];
  const trades = [] as { token: string; side: string; recipient: string }[];
  for (let w = 0; w < 5; w++) for (const t of ["0xt4", "0xt5", "0xt6"]) trades.push({ token: t, side: "buy", recipient: "0xbot" });
  const cl = buildClusters(tokens, buyersByToken(trades));
  assert.equal(cl.length, 1);
  assert.ok(cl[0].slug.includes("astra"));
});

test("slugs are inherited from the previous tick when members mostly overlap", () => {
  const tokens = [tok(1, "Hood Rat", "HOODRAT"), tok(2, "Hood AI", "HOODAI"), tok(3, "Hood Cat", "HOODCAT"), tok(4, "Hood Dog", "HOODDOG")];
  const cl = buildClusters(tokens, new Map());
  inheritSlugs([{ slug: "stock-hood", members: ["0xt1", "0xt2", "0xt3", "0xt9"] }], cl);
  assert.equal(cl[0].slug, "stock-hood");
});

test("sprayer wallets are dropped before overlap linking", async () => {
  const { dropSprayers } = await import("../src/analyze/cluster.ts");
  const buyers = new Map<string, Set<string>>();
  for (let t = 0; t < 12; t++) buyers.set(`0xt${t}`, new Set(["bot", `w${t}`]));
  const { buyers: clean, dropped } = dropSprayers(buyers, 8);
  assert.equal(dropped, 1);
  for (const s of clean.values()) assert.ok(!s.has("bot"));
});
