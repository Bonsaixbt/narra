import { test } from "node:test";
import assert from "node:assert/strict";
import { issueToken, verifyToken } from "../src/gate.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { StreamHub } from "../src/stream.ts";

test("holder tokens round-trip, expire, and reject tampering", () => {
  const t = issueToken("0xABC", 750000, "secret", 60, 1_000_000_000);
  assert.deepEqual(verifyToken(t, "secret", 1_000_000_000), { address: "0xabc", balance: 750000, exp: 1_000_060 });
  assert.equal(verifyToken(t, "secret", 1_000_061_000), null);
  assert.equal(verifyToken(t, "other", 1_000_000_000), null);
  assert.equal(verifyToken(t.slice(0, -2) + "zz", "secret", 1_000_000_000), null);
  assert.equal(verifyToken(undefined, "secret"), null);
});

test("rate limiter refills continuously", () => {
  const r = new RateLimiter(60);
  let t = 0;
  for (let i = 0; i < 60; i++) assert.equal(r.allow("ip", t), true);
  assert.equal(r.allow("ip", t), false);
  t += 1_000; // one second later: one more token
  assert.equal(r.allow("ip", t), true);
  assert.equal(r.allow("ip", t), false);
});

test("stream hub delays events for anonymous sinks and not for holders", () => {
  const hub = new StreamHub(300);
  const seenH: string[] = [], seenA: string[] = [];
  hub.add({ holder: true, write: (e) => seenH.push(e.type) });
  hub.add({ holder: false, write: (e) => seenA.push(e.type) });
  const ev = { schema_version: "1.0.0" as const, ts: "t", type: "STATUS" as const, slug: "x", to: "HOT" as const };
  hub.publish(ev, 0);
  hub.publish({ ...ev, type: "SYNC" }, 0);
  assert.deepEqual(seenH, ["STATUS", "SYNC"]);
  assert.deepEqual(seenA, ["SYNC"]);
  hub.flush(299_000); assert.deepEqual(seenA, ["SYNC"]);
  hub.flush(300_000); assert.deepEqual(seenA, ["SYNC", "STATUS"]);
  hub.stop();
});
