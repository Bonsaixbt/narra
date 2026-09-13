/**
 * Live trigger over WebSocket. narra keeps its one ingest path (chunked eth_getLogs with a cursor); the socket only
 * says "something happened, sync now". A launch log on the factory or a swap on the PoolManager wakes the loop,
 * debounced to one tick per `minGapMs`. A watchdog re-subscribes after 45 s of silence and the caller's polling
 * interval remains the floor, so a dead socket degrades to v0.1 behaviour instead of a silent feed.
 */
import type { PublicClient } from "viem";
import { ADDR } from "../chain/constants.js";
import { TOPICS } from "../chain/topics.js";

export interface LiveHandle { stop(): void; health(): { mode: "websocket" | "polling"; lastEventAt: number; recoveries: number; note: string } }

export function liveTrigger(ws: PublicClient | null, onWake: (reason: string) => void, opts: { minGapMs?: number; quietMs?: number } = {}): LiveHandle {
  const minGap = opts.minGapMs ?? 5_000, quiet = opts.quietMs ?? 45_000;
  const h = { mode: (ws ? "websocket" : "polling") as "websocket" | "polling", lastEventAt: Date.now(), recoveries: 0, note: ws ? "" : "no websocket configured" };
  if (!ws) return { stop() {}, health: () => ({ ...h }) };
  let unwatch: (() => void)[] = [];
  let pending: NodeJS.Timeout | null = null;
  let lastWake = 0;
  const wake = (reason: string) => {
    h.lastEventAt = Date.now();
    if (pending) return;
    const wait = Math.max(0, minGap - (Date.now() - lastWake));
    pending = setTimeout(() => { pending = null; lastWake = Date.now(); onWake(reason); }, wait);
  };
  const subscribe = () => {
    for (const u of unwatch) u();
    unwatch = [
      ws.watchEvent({ address: ADDR.ponsFactory, onLogs: () => wake("launch"), onError: (e) => { h.note = `factory sub: ${e.message.split("\n")[0].slice(0, 80)}`; } }),
      ws.watchEvent({ address: ADDR.v4PoolManager, onLogs: (logs) => { if (logs.some((l) => l.topics[0]?.toLowerCase() === TOPICS.poolSwap.toLowerCase())) wake("swap"); }, onError: (e) => { h.note = `pool sub: ${e.message.split("\n")[0].slice(0, 80)}`; } }),
    ];
  };
  try { subscribe(); } catch (e) { h.mode = "polling"; h.note = `subscribe failed: ${(e as Error).message.split("\n")[0]}`; }
  const watchdog = setInterval(() => {
    const silent = Date.now() - h.lastEventAt;
    if (silent > quiet) { h.recoveries++; h.mode = "polling"; h.note = `socket quiet ${Math.round(silent / 1000)}s, re-subscribed`; try { subscribe(); } catch { /* keep polling */ } }
    else if (h.mode === "polling" && silent < 10_000) { h.mode = "websocket"; h.note = "socket delivering"; }
  }, 10_000);
  watchdog.unref();
  return { stop() { clearInterval(watchdog); if (pending) clearTimeout(pending); for (const u of unwatch) u(); }, health: () => ({ ...h }) };
}
