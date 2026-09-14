/** SSE hub. Holders see events as they happen; anonymous viewers see them `delaySec` later. */
import type { WatchEvent } from "narrahood";

type Sink = { write: (e: WatchEvent) => void; holder: boolean };

export class StreamHub {
  private sinks = new Set<Sink>();
  private delayed: { at: number; e: WatchEvent }[] = [];
  /** ring buffer for the polling endpoint: the last `keep` events with the wall-clock they were published at */
  private recent: { at: number; e: WatchEvent }[] = [];
  private keep = 500;
  private timer: NodeJS.Timeout;
  constructor(private delaySec: number) {
    this.timer = setInterval(() => this.flush(), 1_000);
    this.timer.unref();
  }
  add(sink: Sink): () => void { this.sinks.add(sink); return () => this.sinks.delete(sink); }
  publish(e: WatchEvent, now = Date.now()): void {
    this.recent.push({ at: now, e }); if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    for (const s of this.sinks) if (s.holder) s.write(e);
    if (e.type === "SYNC") { for (const s of this.sinks) if (!s.holder) s.write(e); return; } // heartbeats are not alpha
    this.delayed.push({ at: now + this.delaySec * 1000, e });
  }
  flush(now = Date.now()): WatchEvent[] {
    const due: WatchEvent[] = [];
    while (this.delayed.length && this.delayed[0].at <= now) due.push(this.delayed.shift()!.e);
    for (const e of due) for (const s of this.sinks) if (!s.holder) s.write(e);
    return due;
  }
  /** Events published after `sinceMs`; anonymous callers only see those older than the public delay. */
  since(sinceMs: number, holder: boolean, now = Date.now()): { events: WatchEvent[]; until: number } {
    const cutoff = holder ? now : now - this.delaySec * 1000;
    const events = this.recent.filter((r) => r.at > sinceMs && r.at <= cutoff).map((r) => r.e);
    return { events, until: cutoff };
  }
  get size(): number { return this.sinks.size; }
  stop(): void { clearInterval(this.timer); }
}
