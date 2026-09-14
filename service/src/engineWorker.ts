/**
 * The analysis children. Two forks of this file: the fast one owns the only Narra that syncs and recomputes the
 * 60m/15m analyses every tick; the slow one recomputes 4h and the trend on their own schedule so a 200 s pass never
 * lets the fast windows go stale. Each ships its results to the parent over IPC (advanced serialization keeps Maps
 * and Sets). The parent answers HTTP, SSE and the bot from those objects and never blocks on a clustering pass.
 */
import { Narra, liveTrigger } from "narra-cli";
import { CONFIG } from "./config.js";

type Window = "15m" | "60m" | "4h";
export type Role = "fast" | "slow";
export type WorkerMsg = { kind: "analysis"; window: Window; a: unknown; meta: unknown; at: number; tick_ms: number } | { kind: "trend"; t: unknown; at: number; ms: number } | { kind: "error"; error: string } | { kind: "tick"; ticks: number };
/** The one trend the service serves: two days in four-hour steps. Anything else is a CLI question (`narra trend --hours`). */
export const TREND = { hours: 48, step: 4 } as const;
/** The slow worker checks its schedule this often; the work itself runs every slowWindowEverySec / trendEverySec. */
const SLOW_POLL_MS = 15_000;

export async function runEngineWorker(role: Role): Promise<void> {
  const n = new Narra();
  const send = (m: WorkerMsg) => process.send?.(m);
  let stop = false, wake: (() => void) | null = null, lastTick = 0, ticks = 0;
  const fast = role === "fast";
  const fastWindows = CONFIG.windows.filter((w) => w !== "4h");
  const deepest: Window = CONFIG.windows.includes("4h") ? "4h" : CONFIG.windows.includes("60m") ? "60m" : "15m";
  const live = fast ? liveTrigger(n.clients.ws, () => { if (Date.now() - lastTick > 10_000) wake?.(); }) : null;
  process.on("disconnect", () => { stop = true; live?.stop(); n.close(); process.exit(0); });
  if (!fast) {
    // the fast worker syncs; wait for its first analysis before reading the store, or the first 4h pass sees a stale cursor
    await new Promise<void>((r) => process.on("message", (m: { kind?: string }) => { if (m?.kind === "go") r(); }));
  }
  if (!fast) {
    // ticks from before flow_snapshots existed: recompute the last day's sampled edges once, so /history/flow is not empty
    try { for (const w of CONFIG.windows) { const t0 = Date.now(); const h = n.historyFlow(w, 24, "15m"); if (h.backfilled) console.log(`flow history: backfilled ${h.backfilled} ${w} ticks in ${Date.now() - t0} ms`); } }
    catch (e) { send({ kind: "error", error: `flow backfill: ${(e as Error).message.split("\n")[0]}` }); }
  }
  let lastSlow = 0, lastTrend = 0;
  while (!stop) {
    const t0 = Date.now();
    try {
      if (fast) {
        await n.sync(deepest);
        for (const w of fastWindows) {
          const t1 = Date.now();
          const r = await n.prepare({ window: w, noSync: true });
          send({ kind: "analysis", window: w, a: r.a, meta: r.meta, at: Date.now(), tick_ms: Date.now() - t1 });
        }
        ticks++; send({ kind: "tick", ticks });
      } else {
        if (CONFIG.windows.includes("4h") && Date.now() - lastSlow >= CONFIG.slowWindowEverySec * 1000) {
          const t1 = Date.now();
          const r = await n.prepare({ window: "4h", noSync: true });
          lastSlow = Date.now();
          send({ kind: "analysis", window: "4h", a: r.a, meta: r.meta, at: lastSlow, tick_ms: lastSlow - t1 });
        }
        if (Date.now() - lastTrend >= CONFIG.trendEverySec * 1000) {
          // a 48 h aggregate over the trade tables (seconds of SQL): computed here so a request never waits on it
          const t2 = Date.now();
          const t = n.trend(TREND.hours, TREND.step);
          lastTrend = Date.now();
          send({ kind: "trend", t, at: lastTrend, ms: lastTrend - t2 });
        }
      }
    } catch (e) { send({ kind: "error", error: (e as Error).message.split("\n")[0] }); }
    lastTick = Date.now();
    const period = fast ? CONFIG.tickSec * 1000 : SLOW_POLL_MS;
    await new Promise<void>((r) => { const id = setTimeout(() => { wake = null; r(); }, Math.max(1_000, period - (Date.now() - t0))); wake = () => { clearTimeout(id); wake = null; r(); }; });
  }
}

if (process.argv.includes("--engine-worker")) void runEngineWorker(process.argv.includes("--slow") ? "slow" : "fast");
