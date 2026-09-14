/** Old curves are resolved by asking the curve and the factory, not by walking factory logs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store/db.ts";
import { resolveCurves } from "../src/ingest/sync.ts";

test("resolveCurves builds launch rows from curve.token()/launchedAt() and factory.getLaunchedToken() in two multicalls per batch", async () => {
  const s = new Store(":memory:");
  const calls: number[] = [];
  const http = { multicall: async ({ contracts }: { contracts: { functionName: string; args?: unknown[] }[] }) => {
    calls.push(contracts.length);
    return contracts.map((c) => {
      if (c.functionName === "token") return { status: "success", result: "0xAAAA000000000000000000000000000000000001" };
      if (c.functionName === "launchedAt") return { status: "success", result: 1_000_000n };
      return { status: "success", result: { deployer: "0xDDDD000000000000000000000000000000000001", pairToken: "0x0000000000000000000000000000000000000000", graduationThreshold: 5n, phase: 0, sweptAt: 0n, exists: true } };
    });
  } } as never;
  const pairs = new Set<string>();
  const found = await resolveCurves({ store: s, http }, ["0xCCCC000000000000000000000000000000000001"], pairs, (ts) => ts * 10);
  assert.equal(found, 1);
  assert.deepEqual(calls, [2, 1], "one multicall for the curve reads, one for the factory");
  const row = s.launchesFor(["0xaaaa000000000000000000000000000000000001"])[0];
  assert.equal(row.curve, "0xcccc000000000000000000000000000000000001");
  assert.equal(row.deployer, "0xdddd000000000000000000000000000000000001");
  assert.equal(row.ts, 1_000_000); assert.equal(row.block, 10_000_000);
  assert.ok(pairs.has("0x0000000000000000000000000000000000000000"));
  s.close();
});
