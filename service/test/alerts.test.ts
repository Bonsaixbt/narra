import { test } from "node:test";
import assert from "node:assert/strict";
import { Alerter, formatAlert, alertConfig } from "../src/alerts.ts";

const ev = (over: Record<string, unknown>) => ({ schema_version: "1.0.0" as const, ts: "t", type: "STATUS" as const, ...over }) as Parameters<typeof formatAlert>[0];

test("only status flips to HOT/ROTATING and big edges and graduations become alerts", () => {
  assert.ok(formatAlert(ev({ type: "STATUS", slug: "x", to: "HOT", from: "EMERGING" }))?.text.includes("x → HOT"));
  assert.equal(formatAlert(ev({ type: "STATUS", slug: "x", to: "COOLING" })), null);
  assert.equal(formatAlert(ev({ type: "EDGE", from: "a", to: "b", wallets: 3 })), null);
  assert.ok(formatAlert(ev({ type: "EDGE", from: "a", to: "b", wallets: 12 }))?.text.includes("12 wallets"));
  assert.ok(formatAlert(ev({ type: "GRAD", token: "0xabc", symbol: "SOUP", slug: "soup" }))?.text.includes("$SOUP"));
  assert.equal(formatAlert(ev({ type: "SYNC" })), null);
});

test("alerter dedupes per key, respects the per-minute cap, and posts to every chat", async () => {
  const calls: string[] = [];
  const fetchFn = (async (_u: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body)).chat_id); return { ok: true } as Response; }) as unknown as typeof fetch;
  const a = new Alerter({ token: "t", chats: ["1", "2"], events: new Set(["STATUS"]), dedupeSec: 600, perMinute: 2, delaySec: 0 }, fetchFn);
  assert.equal(a.offer(ev({ slug: "x", to: "HOT" }), 0), true);
  assert.equal(a.offer(ev({ slug: "x", to: "HOT" }), 1000), false);      // duplicate inside the window
  assert.equal(a.offer(ev({ slug: "y", to: "ROTATING IN" }), 0), true);
  assert.equal(a.offer(ev({ slug: "z", to: "HOT" }), 0), true);
  assert.equal(await a.flush(0), 2);                                      // cap: two messages this minute
  assert.deepEqual(calls, ["1", "2", "1", "2"]);
  assert.equal(await a.flush(61_000), 1);
  a.stop();
  assert.equal(alertConfig({}), null);
  assert.equal(alertConfig({ NARRA_TG_BOT_TOKEN: "t", NARRA_TG_CHAT_IDS: "1, 2" })?.chats.length, 2);
});
