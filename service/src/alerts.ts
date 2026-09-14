/**
 * Telegram alerts. The engine's events go to one or more chats through a bot as one digest-style message per
 * `batchSec` (default 5 min): metas that turned HOT or started rotating, the biggest moves of repeat buyers,
 * graduations. One entry per slug per `dedupeSec`, nothing during the first `warmupSec` after a start (the first
 * tick replays every status), never a URL to a trade. Public chats can be delayed like the public stream.
 */
import type { WatchEvent } from "narrahood";

export interface AlertConfig { token: string; chats: string[]; events: Set<string>; dedupeSec: number; perMinute: number; delaySec: number; batchSec: number; warmupSec: number; siteUrl: string }

export function alertConfig(env: NodeJS.ProcessEnv = process.env): AlertConfig | null {
  const token = env.NARRA_TG_BOT_TOKEN ?? "", chats = (env.NARRA_TG_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !chats.length) return null;
  return { token, chats, events: new Set((env.NARRA_TG_EVENTS ?? "STATUS,EDGE,GRAD").split(",").map((s) => s.trim().toUpperCase())), dedupeSec: Number(env.NARRA_TG_DEDUPE_S ?? 600), perMinute: Number(env.NARRA_TG_PER_MINUTE ?? 20), delaySec: Number(env.NARRA_TG_DELAY_S ?? 0), batchSec: Number(env.NARRA_TG_ALERT_BATCH_S ?? 300), warmupSec: Number(env.NARRA_TG_ALERT_WARMUP_S ?? 90), siteUrl: (env.NARRA_SITE_URL ?? env.NARRA_API_ORIGIN ?? "").replace(/\/$/, "") };
}

export type AlertKind = "hot" | "out" | "move" | "grad";
export interface AlertItem { key: string; kind: AlertKind; weight: number; slug?: string; status?: string; was?: string; from?: string; to?: string; wallets?: number; token?: string; symbol?: string; note?: string }

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** Which events are worth a place in the next digest. `null` means skip. */
export function formatAlert(e: WatchEvent): AlertItem | null {
  switch (e.type) {
    case "STATUS":
      if (e.to !== "HOT" && e.to !== "ROTATING IN" && e.to !== "ROTATING OUT") return null;
      return { key: `status:${e.slug}:${e.to}`, kind: e.to === "ROTATING OUT" ? "out" : "hot", weight: 0, slug: e.slug, status: e.to, was: e.from && e.from !== "NEW" ? e.from : undefined, note: e.note };
    case "EDGE":
      if ((e.wallets ?? 0) < 10) return null;
      return { key: `edge:${e.from}:${e.to}`, kind: "move", weight: e.wallets ?? 0, from: e.from, to: e.to, wallets: e.wallets, note: e.note };
    case "GRAD":
      return { key: `grad:${e.token}`, kind: "grad", weight: 0, token: e.token, symbol: e.symbol, slug: e.slug };
    default: return null;
  }
}

const SECTIONS: { kind: AlertKind; title: string; max: number }[] = [
  { kind: "hot", title: "🔥 now HOT or rotating in", max: 8 },
  { kind: "out", title: "🟣 rotating out", max: 6 },
  { kind: "move", title: "↪ where repeat buyers moved", max: 6 },
  { kind: "grad", title: "🎓 graduated", max: 5 },
];

/** One HTML line per item; metas and coins link into the site when `siteUrl` is set. */
export function alertLine(i: AlertItem, siteUrl: string): string {
  const meta = (slug: string) => (siteUrl ? `<a href="${siteUrl}/cluster/${encodeURIComponent(slug)}">${esc(slug)}</a>` : esc(slug));
  const note = i.note ? ` · ${esc(i.note)}` : "";
  switch (i.kind) {
    case "hot": case "out": return `${meta(i.slug ?? "")} → ${i.status}${i.was ? ` (was ${i.was})` : ""}${note}`;
    case "move": return `${i.wallets} wallets ${meta(i.from ?? "")} → <b>${meta(i.to ?? "")}</b>${note}`;
    case "grad": { const label = `$${i.symbol || "?"}`; const coin = siteUrl && i.token ? `<a href="${siteUrl}/coin/${i.token}">${esc(label)}</a>` : esc(label); return `${coin}${i.slug ? ` · meta ${meta(i.slug)}` : ""}${i.token ? `\n<code>${i.token}</code>` : ""}`; }
  }
}

/** One message out of a batch of items: sections with blank lines between them, the biggest moves first. */
export function formatAlertDigest(items: AlertItem[], minutes: number, siteUrl = ""): string {
  const blocks: string[] = [`<b>narra · last ${minutes} min</b>`];
  for (const sec of SECTIONS) {
    const mine = items.filter((i) => i.kind === sec.kind).sort((a, b) => b.weight - a.weight);
    if (!mine.length) continue;
    const lines = mine.slice(0, sec.max).map((i) => alertLine(i, siteUrl));
    if (mine.length > sec.max) lines.push(`… ${mine.length - sec.max} more`);
    blocks.push(`<b>${sec.title}</b>\n${lines.join("\n")}`);
  }
  blocks.push(siteUrl ? `<a href="${siteUrl}/">the board</a> · /why meta · /coin 0x…` : "/meta for the board · /why meta");
  return blocks.join("\n\n");
}

export class Alerter {
  private seen = new Map<string, number>();
  private sentAt: number[] = [];
  private batch: AlertItem[] = [];
  private batchOpenedAt = 0;
  private timer: NodeJS.Timeout;
  private readonly startedAt: number;
  sent = 0; dropped = 0; errors = 0;
  /** The last Telegram refusal (`400 chat not found`, `429 …`), so health says why alerts do not arrive. */
  lastError = "";
  constructor(private cfg: AlertConfig, private fetchFn: typeof fetch = fetch, now = Date.now()) { this.startedAt = now; this.timer = setInterval(() => void this.flush(), 1_000); this.timer.unref(); }

  offer(e: WatchEvent, now = Date.now()): boolean {
    if (!this.cfg.events.has(e.type)) return false;
    if (now - this.startedAt < this.cfg.warmupSec * 1000) { this.dropped++; return false; } // the first tick replays every status
    const a = formatAlert(e); if (!a) return false;
    const last = this.seen.get(a.key);
    if (last !== undefined && now - last < this.cfg.dedupeSec * 1000) { this.dropped++; return false; }
    this.seen.set(a.key, now);
    if (this.seen.size > 5_000) for (const [k, t] of this.seen) if (now - t > this.cfg.dedupeSec * 1000) this.seen.delete(k);
    if (!this.batch.length) this.batchOpenedAt = now;
    this.batch.push(a);
    return true;
  }

  /** Telegram's 429 says how long to wait; the batch stays and is sent after the pause. */
  private pausedUntil = 0;
  /** Sends the open batch once it is `batchSec` old (plus the public delay). Returns how many messages went out. */
  async flush(now = Date.now()): Promise<number> {
    if (!this.batch.length || now < this.pausedUntil) return 0;
    if (now - this.batchOpenedAt < (this.cfg.batchSec + this.cfg.delaySec) * 1000) return 0;
    this.sentAt = this.sentAt.filter((t) => now - t < 60_000);
    if (this.sentAt.length >= this.cfg.perMinute) return 0;
    const text = formatAlertDigest(this.batch, Math.max(1, Math.round(this.cfg.batchSec / 60)), this.cfg.siteUrl);
    let n = 0;
    for (const chat of this.cfg.chats) {
      try {
        const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
        if (r.ok) { this.sent++; n++; continue; }
        const body = (await r.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
        this.errors++; this.lastError = `${r.status} ${body.description ?? ""}`.trim();
        if (r.status === 429) { this.pausedUntil = now + ((body.parameters?.retry_after ?? 5) + 1) * 1000; return n; }
      } catch (e) { this.errors++; this.lastError = (e as Error).message; }
    }
    this.batch = []; this.sentAt.push(now);
    return n;
  }

  stop(): void { clearInterval(this.timer); }
}
