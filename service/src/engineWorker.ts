/**
 * The analysis child. Owns the only Narra that syncs and analyses; ships each window's analysis to the parent over
 * IPC (advanced serialization keeps Maps and Sets). The parent answers HTTP, SSE and the bot from those objects and
 * never blocks on a clustering pass.
 */
import { Narra, liveTrigger } from "narra-cli";
import { CONFIG } from "./config.js";

type Window = "15m" | "60m" | "4h";
export type WorkerMsg = { kind: "analysis"; window: Window; a: unknown; meta: unknown; at: number; tick_ms: number } | { kind: "trend"; t: unknown; at: number; ms: number } | { kind: "error"; error: string } | { kind: "tick"; ticks: number };
/** The one trend the service serves: two days in four-hour steps. Anything else is a CLI question (`narra trend --hours`). */
export const TREND = { hours: 48, step: 4 } as const;

export async function runEngineWorker(): Promise<void> {
  const n = new Narra();
  const send = (m: WorkerMsg) => process.send?.(m);
  let stop = false, wake: (() => void) | null = null, lastTick = 0, ticks = 0;
  const lastSlow = new Map<Window, number>();
  let lastTrend = 0;
  const live = liveTrigger(n.clients.ws, () => { if (Date.now() - lastTick > 10_000) wake?.(); });
  process.on("disconnect", () => { stop = true; live.stop(); n.close(); process.exit(0); });
  while (!stop) {
    const t0 = Date.now();
    try {
      const deepest: Window = CONFIG.windows.includes("4h") ? "4h" : CONFIG.windows.includes("60m") ? "60m" : "15m";
      await n.sync(deepest);
      for (const w of CONFIG.windows) {
        if (w === "4h" && Date.now() - (lastSlow.get(w) ?? 0) < CONFIG.slowWindowEverySec * 1000) continue;
        const t1 = Date.now();
        const r = await n.prepare({ window: w, noSync: true });
        lastSlow.set(w, Date.now());
        send({ kind: "analysis", window: w, a: r.a, meta: r.meta, at: Date.now(), tick_ms: Date.now() - t1 });
      }
      if (Date.now() - lastTrend >= CONFIG.trendEverySec * 1000) {
        // trend is a 48 h aggregate over the trade tables (seconds of SQL): computed here so a request never waits on it
        const t2 = Date.now();
        const t = n.trend(TREND.hours, TREND.step);
        lastTrend = Date.now();
        send({ kind: "trend", t, at: lastTrend, ms: lastTrend - t2 });
      }
      ticks++; send({ kind: "tick", ticks });
    } catch (e) { send({ kind: "error", error: (e as Error).message.split("\n")[0] }); }
    lastTick = Date.now();
    await new Promise<void>((r) => { const id = setTimeout(() => { wake = null; r(); }, Math.max(1_000, CONFIG.tickSec * 1000 - (Date.now() - t0))); wake = () => { clearTimeout(id); wake = null; r(); }; });
  }
}

if (process.argv.includes("--engine-worker")) void runEngineWorker();
