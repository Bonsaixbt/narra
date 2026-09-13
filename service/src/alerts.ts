/**
 * Telegram alerts. The engine's events go to one or more chats through a bot: a status turning HOT or ROTATING IN,
 * a new flow edge, a graduation. One message per slug per `dedupeSec`, at most `perMinute` messages, never a URL
 * to a trade. Public chats can be delayed like the public stream.
 */
import type { WatchEvent } from "narra-cli";

export interface AlertConfig { token: string; chats: string[]; events: Set<string>; dedupeSec: number; perMinute: number; delaySec: number }

export function alertConfig(env: NodeJS.ProcessEnv = process.env): AlertConfig | null {
  const token = env.NARRA_TG_BOT_TOKEN ?? "", chats = (env.NARRA_TG_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !chats.length) return null;
  return { token, chats, events: new Set((env.NARRA_TG_EVENTS ?? "STATUS,EDGE,GRAD").split(",").map((s) => s.trim().toUpperCase())), dedupeSec: Number(env.NARRA_TG_DEDUPE_S ?? 600), perMinute: Number(env.NARRA_TG_PER_MINUTE ?? 20), delaySec: Number(env.NARRA_TG_DELAY_S ?? 0) };
}

/** Which events are worth a phone buzz, and the text for them. `null` means skip. */
export function formatAlert(e: WatchEvent): { key: string; text: string } | null {
  switch (e.type) {
    case "STATUS":
      if (e.to !== "HOT" && e.to !== "ROTATING IN" && e.to !== "ROTATING OUT") return null;
      return { key: `status:${e.slug}:${e.to}`, text: `${e.to === "ROTATING OUT" ? "🟣" : "🔥"} ${e.slug} → ${e.to}${e.from && e.from !== "NEW" ? ` (was ${e.from})` : ""}\n${e.note ?? ""}`.trim() };
    case "EDGE":
      if ((e.wallets ?? 0) < 8) return null;
      return { key: `edge:${e.from}:${e.to}`, text: `↪ ${e.wallets} wallets moved ${e.from} → ${e.to}${e.note ? `\n${e.note}` : ""}` };
    case "GRAD":
      return { key: `grad:${e.token}`, text: `🎓 $${e.symbol || "?"} graduated${e.slug ? ` · meta ${e.slug}` : ""}\n${e.token}` };
    default: return null;
  }
}

export class Alerter {
  private seen = new Map<string, number>();
  private sentAt: number[] = [];
  private queue: { at: number; text: string }[] = [];
  private timer: NodeJS.Timeout;
  sent = 0; dropped = 0; errors = 0;
  constructor(private cfg: AlertConfig, private fetchFn: typeof fetch = fetch) { this.timer = setInterval(() => void this.flush(), 1_000); this.timer.unref(); }

  offer(e: WatchEvent, now = Date.now()): boolean {
    if (!this.cfg.events.has(e.type)) return false;
    const a = formatAlert(e); if (!a) return false;
    const last = this.seen.get(a.key);
    if (last !== undefined && now - last < this.cfg.dedupeSec * 1000) { this.dropped++; return false; }
    this.seen.set(a.key, now);
    if (this.seen.size > 5_000) for (const [k, t] of this.seen) if (now - t > this.cfg.dedupeSec * 1000) this.seen.delete(k);
    this.queue.push({ at: now + this.cfg.delaySec * 1000, text: a.text });
    return true;
  }

  async flush(now = Date.now()): Promise<number> {
    this.sentAt = this.sentAt.filter((t) => now - t < 60_000);
    let n = 0;
    while (this.queue.length && this.queue[0].at <= now && this.sentAt.length < this.cfg.perMinute) {
      const { text } = this.queue.shift()!;
      for (const chat of this.cfg.chats) {
        try {
          const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
          if (!r.ok) this.errors++; else this.sent++;
        } catch { this.errors++; }
      }
      this.sentAt.push(now); n++;
    }
    return n;
  }
  stop(): void { clearInterval(this.timer); }
}
