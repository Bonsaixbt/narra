/** The engine seen from the API process: a cache of analyses filled by the child, a Narra that only reads. */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Narra, diffEvents, type Analysis, type WatchEvent, type QueryOptions } from "narra-cli";
import { CONFIG } from "./config.js";
import type { WorkerMsg } from "./engineWorker.js";

type TrendCached = { t: ReturnType<Narra["trend"]>; at: number; ms: number };

type Window = "15m" | "60m" | "4h";
type Cached = NonNullable<QueryOptions["analysis"]> & { at: number };

export class Engine {
  /** Reads only: coin cards, history, trend, holder balances. Never syncs. */
  readonly n = new Narra();
  private cache = new Map<Window, Cached>();
  private trendCache: TrendCached | null = null;
  private state = { statuses: new Map<string, string>(), edges: new Set<string>(), members: new Map<string, string>(), phases: new Map<string, string>(), seenLaunch: new Set<string>(), first: true };
  private child: ChildProcess | null = null;
  private restarts = 0;
  lastError = "";
  ticks = 0;
  tickMs: Record<string, number> = {};
  constructor(private onEvent: (e: WatchEvent) => void) {}

  get(window: Window): Cached | undefined { return this.cache.get(window); }
  /** The precomputed 48 h / 4 h trend, or null before the worker's first pass. */
  trend(): TrendCached | null { return this.trendCache; }

  private spawn(): void {
    const worker = fileURLToPath(new URL("./engineWorker.js", import.meta.url));
    this.child = fork(worker, ["--engine-worker"], { execArgv: process.execArgv.filter((x) => x !== "--eval" && x !== "-e"), serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });
    this.child.on("message", (m: WorkerMsg) => {
      if (m.kind === "analysis") {
        const a = m.a as Analysis;
        this.cache.set(m.window, { a, meta: m.meta as Cached["meta"], at: m.at });
        this.tickMs[m.window] = m.tick_ms;
        if (m.window === "60m") {
          for (const e of diffEvents(this.state, a, new Date().toISOString())) this.onEvent(e);
          const meta = m.meta as { head_block: number | null };
          this.onEvent({ schema_version: "1.0.0", ts: new Date().toISOString(), type: "SYNC", note: `head ${meta.head_block ?? "?"} · ${a.clusters.length} metas · analysis ${m.tick_ms} ms` });
        }
        this.lastError = "";
      } else if (m.kind === "trend") { this.trendCache = { t: m.t as TrendCached["t"], at: m.at, ms: m.ms }; this.tickMs.trend = m.ms; }
      else if (m.kind === "tick") this.ticks = m.ticks;
      else if (m.kind === "error") this.lastError = m.error;
    });
    this.child.on("exit", (code) => {
      if (this.stopped) return;
      this.restarts++; this.lastError = `engine worker exited (${code}); restarting`;
      setTimeout(() => this.spawn(), Math.min(60_000, 5_000 * this.restarts));
    });
  }
  private stopped = false;

  start(): void { this.spawn(); }

  health() {
    const c = this.cache.get("60m");
    const age = c ? Math.round((Date.now() - c.at) / 1000) : null;
    const stats = this.n.store.stats();
    const cursor = this.n.store.getCursor("main")?.last_block ?? null;
    const lag = c?.meta.head_block !== null && c?.meta.head_block !== undefined && cursor !== null ? Math.max(0, c.meta.head_block - cursor) : null;
    const ok = !!c && age !== null && age <= CONFIG.staleAfterSec && (lag === null || lag <= CONFIG.maxLagBlocks) && !this.lastError;
    return { ok, snapshot_age_s: age, head_block: c?.meta.head_block ?? null, cursor_block: cursor, lag_blocks: lag, ticks: this.ticks, tick_ms: this.tickMs, worker_restarts: this.restarts, last_error: this.lastError || null, windows: [...this.cache.keys()], ...stats };
  }

  close(): void { this.stopped = true; try { this.child?.disconnect(); } catch { /* gone */ } this.n.close(); }
}
export type { Analysis, Window };
