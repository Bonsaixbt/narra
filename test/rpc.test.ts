import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate, parseEndpoints } from "../src/chain/rpc.ts";

type Handler = (url: string, body: { method: string; id: number }) => { status?: number; body?: unknown; text?: string };

function fakeFetch(handler: Handler, log: { url: string; method: string }[] = []) {
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    log.push({ url, method: body.method });
    const r = handler(url, body);
    const text = r.text ?? JSON.stringify({ jsonrpc: "2.0", id: body.id, result: r.body ?? null });
    return { status: r.status ?? 200, text: async () => text } as Response;
  }) as unknown as typeof fetch;
  return { fetch: f, log };
}

const specs = [
  { url: "https://a", logs: false, label: "a", concurrency: 2 },
  { url: "https://b", logs: true, label: "b", concurrency: 1 },
];
const noSleep = { sleep: async () => {}, now: Date.now };

test("eth_getLogs is routed only to endpoints that serve logs", async () => {
  const { fetch, log } = fakeFetch(() => ({ body: [] }));
  const gate = createGate(specs, { fetchFn: fetch, ...noSleep });
  await gate.request("eth_getLogs", [{}]);
  await gate.request("eth_blockNumber", []);
  assert.deepEqual(log, [{ url: "https://b", method: "eth_getLogs" }, { url: "https://a", method: "eth_blockNumber" }]);
});

test("a 429 benches the endpoint and the call moves to the next one", async () => {
  const { fetch, log } = fakeFetch((url) => (url === "https://a" ? { status: 429, text: "slow down" } : { body: "0x10" }));
  const gate = createGate(specs, { fetchFn: fetch, ...noSleep });
  const r = await gate.request("eth_blockNumber");
  assert.equal(r, "0x10");
  assert.deepEqual(log.map((l) => l.url), ["https://a", "https://b"]);
  assert.equal(gate.stats().endpoints[0].benched, true);
  assert.equal(gate.stats().refusals, 1);
});

test("json-rpc errors surface as RpcError with the code, not as retries", async () => {
  const { fetch, log } = fakeFetch((_u, b) => ({ text: JSON.stringify({ jsonrpc: "2.0", id: b.id, error: { code: 3, message: "execution reverted" } }) }));
  const gate = createGate(specs, { fetchFn: fetch, ...noSleep });
  await assert.rejects(gate.request("eth_call", []), (e: Error & { code?: number }) => e.code === 3 && /reverted/.test(e.message));
  assert.equal(log.length, 1);
});

test("per-endpoint concurrency cap is respected", async () => {
  let inFlight = 0, peak = 0;
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: 1 }) } as Response;
  }) as unknown as typeof fetch;
  const gate = createGate([specs[0]], { fetchFn: f, ...noSleep });
  await Promise.all(Array.from({ length: 8 }, () => gate.request("eth_chainId")));
  assert.equal(peak, 2);
});

test("parseEndpoints understands #nologs and falls back to defaults", () => {
  assert.equal(parseEndpoints(undefined).length, 2);
  const e = parseEndpoints("https://x.example/k1,https://y.example/k2#nologs");
  assert.deepEqual(e.map((x) => [x.label, x.logs]), [["x.example", true], ["y.example", false]]);
});

test("eth_getLogs is split in halves when the provider rejects the block range", async () => {
  const calls: [number, number][] = [];
  const { fetch } = fakeFetch((_u, b) => {
    const p = (b as unknown as { params: [{ fromBlock: string; toBlock: string }] }).params[0];
    const from = Number(BigInt(p.fromBlock)), to = Number(BigInt(p.toBlock));
    calls.push([from, to]);
    if (to - from > 100) return { text: JSON.stringify({ jsonrpc: "2.0", id: b.id, error: { code: -32000, message: "Block range limit exceeded." } }) };
    return { body: [{ blockNumber: p.fromBlock }] };
  });
  const gate = createGate([specs[1]], { fetchFn: fetch, ...noSleep });
  const r = (await gate.request("eth_getLogs", [{ fromBlock: "0x0", toBlock: "0x190" }])) as unknown[];
  assert.equal(r.length, 4);
  assert.ok(calls.every(([a, b]) => b - a <= 400));
});
