import { test } from "node:test";
import assert from "node:assert/strict";
import { Alerter, formatAlert, alertConfig, alertLine } from "../src/alerts.ts";

const ev = (over: Record<string, unknown>) => ({ schema_version: "1.0.0" as const, ts: "t", type: "STATUS" as const, ...over }) as Parameters<typeof formatAlert>[0];

test("only flips into HOT/ROTATING IN, moves of 15+ wallets and graduations become alerts", () => {
  const hot = formatAlert(ev({ type: "STATUS", slug: "x", to: "HOT", from: "EMERGING", note: "8 CA · 21.24 ETH · 298 buyers" }));
  assert.equal(hot?.kind, "hot"); assert.equal(hot?.weight, 21.24);
  assert.equal(alertLine(hot!, ""), "<b>x</b> · 8 CA · 21.24 ETH · 298 buyers · was emerging");
  assert.equal(alertLine(hot!, "https://narrahood.com"), '<b><a href="https://narrahood.com/cluster/x">x</a></b> · 8 CA · 21.24 ETH · 298 buyers · was emerging');
  assert.equal(formatAlert(ev({ type: "STATUS", slug: "x", to: "COOLING" })), null);
  assert.equal(formatAlert(ev({ type: "STATUS", slug: "x", to: "ROTATING OUT", from: "HOT" })), null, "rotating out is not a buzz");
  assert.equal(formatAlert(ev({ type: "STATUS", slug: "x", to: "HOT", from: "ROTATING IN" })), null, "HOT ↔ ROTATING IN flapping is not news");
  assert.equal(formatAlert(ev({ type: "EDGE", from: "a", to: "b", wallets: 12 })), null);
  assert.ok(alertLine(formatAlert(ev({ type: "EDGE", from: "a", to: "b", wallets: 16 }))!, "").includes("16 wallets"));
  const grad = formatAlert(ev({ type: "GRAD", token: "0xabc", symbol: "SOUP", slug: "soup" }));
  assert.ok(alertLine(grad!, "https://narrahood.com").startsWith('<a href="https://narrahood.com/coin/0xabc">$SOUP</a> · meta <a href='));
  assert.equal(formatAlert(ev({ type: "SYNC" })), null);
});

test("alerter dedupes per key, batches everything into one message per chat, and skips the warm-up replay", async () => {
  const calls: { chat: string; text: string }[] = [];
  const fetchFn = (async (_u: string, init: RequestInit) => { const b = JSON.parse(String(init.body)); calls.push({ chat: b.chat_id, text: b.text }); return { ok: true } as Response; }) as unknown as typeof fetch;
  const a = new Alerter({ token: "t", chats: ["1", "2"], events: new Set(["STATUS", "EDGE", "GRAD"]), dedupeSec: 600, perMinute: 20, delaySec: 0, batchSec: 300, warmupSec: 90, siteUrl: "" }, fetchFn, 0);
  assert.equal(a.offer(ev({ slug: "early", to: "HOT" }), 10_000), false, "inside the warm-up: the first tick replays every status");
  const t0 = 100_000;
  assert.equal(a.offer(ev({ slug: "x", to: "HOT" }), t0), true);
  assert.equal(a.offer(ev({ slug: "x", to: "HOT" }), t0 + 1000), false);      // duplicate inside the window
  assert.equal(a.offer(ev({ slug: "y", to: "ROTATING IN", from: "EMERGING" }), t0), true);
  assert.equal(a.offer(ev({ type: "EDGE", from: "a", to: "b", wallets: 16, note: "0.5 ETH · 0 deployers" }), t0), true);
  assert.equal(a.offer(ev({ type: "EDGE", from: "a", to: "c", wallets: 30 }), t0), true);
  assert.equal(await a.flush(t0 + 60_000), 0, "the batch is not old enough yet");
  assert.equal(await a.flush(t0 + 300_000), 2, "one message per chat");
  assert.deepEqual(calls.map((c) => c.chat), ["1", "2"]);
  const text = calls[0].text;
  assert.ok(text.startsWith("⚡ <b>Pons · last 5 min</b>\n\n<b>🔥 went HOT</b>\n<b>x</b>"), text);
  assert.ok(text.includes("<b>y</b> · was emerging"), text);
  assert.ok(text.indexOf("a → <b>c</b> · 30 wallets") < text.indexOf("a → <b>b</b> · 16 wallets"), "biggest move first");
  assert.ok(!text.includes("early"));
  assert.equal(await a.flush(t0 + 400_000), 0, "nothing new, nothing sent");
  // graduations alone do not buzz the chat: they wait for something hot or age out after four batches
  assert.equal(a.offer(ev({ type: "GRAD", token: "0xabc", symbol: "SOUP" }), t0 + 500_000), true);
  assert.equal(await a.flush(t0 + 900_000), 0, "a lone graduation waits");
  assert.equal(await a.flush(t0 + 500_000 + 4 * 300_000 + 1), 2, "aged out: sent");
  a.stop();
  assert.equal(alertConfig({}), null);
  assert.equal(alertConfig({ NARRA_TG_BOT_TOKEN: "t", NARRA_TG_CHAT_IDS: "1, 2" })?.chats.length, 2);
  assert.equal(alertConfig({ NARRA_TG_BOT_TOKEN: "t", NARRA_TG_CHAT_IDS: "1" })?.batchSec, 300);
});

test("a 429 keeps the batch and retries after the pause", async () => {
  let n = 0;
  const fetchFn = (async () => { n++; return n === 1 ? { ok: false, status: 429, json: async () => ({ description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } }) } as unknown as Response : { ok: true } as Response; }) as unknown as typeof fetch;
  const a = new Alerter({ token: "t", chats: ["1"], events: new Set(["STATUS"]), dedupeSec: 600, perMinute: 20, delaySec: 0, batchSec: 60, warmupSec: 0, siteUrl: "" }, fetchFn, 0);
  a.offer(ev({ slug: "x", to: "HOT" }), 1000);
  assert.equal(await a.flush(61_000), 0);
  assert.equal(a.lastError, "429 Too Many Requests: retry after 3");
  assert.equal(await a.flush(62_000), 0, "still paused");
  assert.equal(await a.flush(66_000), 1, "sent after the pause");
  a.stop();
});
