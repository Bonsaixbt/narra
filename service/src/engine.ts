/** The engine: one Narra, one sync loop, one cached analysis per window, events for the stream. */
import { Narra, diffEvents, liveTrigger, type Analysis, type WatchEvent, type QueryOptions } from "narra-cli";
import { CONFIG } from "./config.js";

type Window = "15m" | "60m" | "4h";
type Cached = NonNullable<QueryOptions["analysis"]> & { at: number };

export class Engine {
  readonly n = new Narra();
  private cache = new Map<Window, Cached>();
  private state = { statuses: new Map<string, string>(), edges: new Set<string>(), members: new Map<string, string>(), phases: new Map<string, string>(), seenLaunch: new Set<string>(), first: true };
  private stop = false;
  private wake: (() => void) | null = null;
  private lastTick = 0;
  lastError = "";
  ticks = 0;
  constructor(private onEvent: (e: WatchEvent) => void) {}

  get(window: Window): Cached | undefined { return this.cache.get(window); }

  async tick(): Promise<void> {
    const t0 = Date.now();
    try {
      // one sync deep enough for the slowest window, then one analysis per window
      const deepest = CONFIG.windows.includes("4h") ? "4h" : CONFIG.windows.includes("60m") ? "60m" : "15m";
      await this.n.sync(deepest);
      for (const w of CONFIG.windows) {
        const prev = this.cache.get(w);
        if (w === "4h" && prev && Date.now() - prev.at < CONFIG.slowWindowEverySec * 1000) continue;
        const r = await this.n.prepare({ window: w, noSync: true });
        this.cache.set(w, { ...r, at: Date.now() });
        if (w === "60m") for (const e of diffEvents(this.state, r.a, new Date().toISOString())) this.onEvent(e);
      }
      const c = this.cache.get("60m");
      this.onEvent({ schema_version: "1.0.0", ts: new Date().toISOString(), type: "SYNC", note: `head ${c?.meta.head_block ?? "?"} · ${c?.a.clusters.length ?? 0} metas · tick ${Date.now() - t0} ms` });
      this.lastError = ""; this.ticks++;
    } catch (e) { this.lastError = (e as Error).message.split("\n")[0]; }
    this.lastTick = Date.now();
  }

  start(): void {
    const live = liveTrigger(this.n.clients.ws, () => { if (Date.now() - this.lastTick > 10_000) this.wake?.(); });
    void (async () => {
      while (!this.stop) {
        await this.tick();
        await new Promise<void>((r) => { const id = setTimeout(() => { this.wake = null; r(); }, CONFIG.tickSec * 1000); this.wake = () => { clearTimeout(id); this.wake = null; r(); }; });
      }
      live.stop();
    })();
  }

  health() {
    const c = this.cache.get("60m");
    const age = c ? Math.round((Date.now() - c.at) / 1000) : null;
    const stats = this.n.store.stats();
    const cursor = this.n.store.getCursor("main")?.last_block ?? null;
    const lag = c?.meta.head_block !== null && c?.meta.head_block !== undefined && cursor !== null ? Math.max(0, c.meta.head_block - cursor) : null;
    const ok = !!c && age !== null && age <= CONFIG.staleAfterSec && (lag === null || lag <= CONFIG.maxLagBlocks) && !this.lastError;
    return { ok, snapshot_age_s: age, head_block: c?.meta.head_block ?? null, cursor_block: cursor, lag_blocks: lag, ticks: this.ticks, last_error: this.lastError || null, windows: [...this.cache.keys()], ...stats };
  }

  close(): void { this.stop = true; this.wake?.(); this.n.close(); }
}
export type { Analysis, Window };
