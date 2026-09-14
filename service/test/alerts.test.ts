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

test("alerter dedupes per key, batches everything into one message per chat, and skips the warm-up replay", async () => {
  const calls: { chat: string; text: string }[] = [];
  const fetchFn = (async (_u: string, init: RequestInit) => { const b = JSON.parse(String(init.body)); calls.push({ chat: b.chat_id, text: b.text }); return { ok: true } as Response; }) as unknown as typeof fetch;
  const a = new Alerter({ token: "t", chats: ["1", "2"], events: new Set(["STATUS", "EDGE"]), dedupeSec: 600, perMinute: 20, delaySec: 0, batchSec: 300, warmupSec: 90 }, fetchFn, 0);
  assert.equal(a.offer(ev({ slug: "early", to: "HOT" }), 10_000), false, "inside the warm-up: the first tick replays every status");
  const t0 = 100_000;
  assert.equal(a.offer(ev({ slug: "x", to: "HOT" }), t0), true);
  assert.equal(a.offer(ev({ slug: "x", to: "HOT" }), t0 + 1000), false);      // duplicate inside the window
  assert.equal(a.offer(ev({ slug: "y", to: "ROTATING OUT", from: "EMERGING" }), t0), true);
  assert.equal(a.offer(ev({ type: "EDGE", from: "a", to: "b", wallets: 12, note: "0.5 ETH · 0 deployers" }), t0), true);
  assert.equal(a.offer(ev({ type: "EDGE", from: "a", to: "c", wallets: 30 }), t0), true);
  assert.equal(await a.flush(t0 + 60_000), 0, "the batch is not old enough yet");
  assert.equal(await a.flush(t0 + 300_000), 2, "one message per chat");
  assert.deepEqual(calls.map((c) => c.chat), ["1", "2"]);
  const text = calls[0].text;
  assert.ok(text.startsWith("narra · last 5 min\n\n🔥 now HOT or rotating in\nx → HOT"), text);
  assert.ok(text.includes("\n\n🟣 rotating out\ny → ROTATING OUT (was EMERGING)"), text);
  assert.ok(text.indexOf("30 wallets a → c") < text.indexOf("12 wallets a → b"), "biggest move first");
  assert.ok(!text.includes("early"));
  assert.equal(await a.flush(t0 + 400_000), 0, "nothing new, nothing sent");
  a.stop();
  assert.equal(alertConfig({}), null);
  assert.equal(alertConfig({ NARRA_TG_BOT_TOKEN: "t", NARRA_TG_CHAT_IDS: "1, 2" })?.chats.length, 2);
  assert.equal(alertConfig({ NARRA_TG_BOT_TOKEN: "t", NARRA_TG_CHAT_IDS: "1" })?.batchSec, 300);
});

test("a 429 keeps the batch and retries after the pause", async () => {
  let n = 0;
  const fetchFn = (async () => { n++; return n === 1 ? { ok: false, status: 429, json: async () => ({ description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } }) } as unknown as Response : { ok: true } as Response; }) as unknown as typeof fetch;
  const a = new Alerter({ token: "t", chats: ["1"], events: new Set(["STATUS"]), dedupeSec: 600, perMinute: 20, delaySec: 0, batchSec: 60, warmupSec: 0 }, fetchFn, 0);
  a.offer(ev({ slug: "x", to: "HOT" }), 1000);
  assert.equal(await a.flush(61_000), 0);
  assert.equal(a.lastError, "429 Too Many Requests: retry after 3");
  assert.equal(await a.flush(62_000), 0, "still paused");
  assert.equal(await a.flush(66_000), 1, "sent after the pause");
  a.stop();
});
