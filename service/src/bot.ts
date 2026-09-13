/**
 * The community bot. A reduced view of the board for a Telegram group or channel: a digest every N minutes and
 * five commands that answer from the same cached analysis the site uses. No wallets, no history, no gate —
 * the point is to keep the chat looking at the same numbers as the terminal and the site.
 *
 * Long polling (getUpdates), so no public webhook is needed.
 */
import type { NowOut, CoinOut, NotPonsOut, FlowOut } from "narra-cli";
import { RateLimiter } from "./ratelimit.js";

export interface BotConfig { token: string; communityChats: string[]; digestEverySec: number; commands: boolean; allowedChats: Set<string> | null }

export function botConfig(env: NodeJS.ProcessEnv = process.env): BotConfig | null {
  const token = env.NARRA_TG_BOT_TOKEN ?? "";
  if (!token) return null;
  const communityChats = (env.NARRA_TG_COMMUNITY_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = (env.NARRA_TG_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { token, communityChats, digestEverySec: Number(env.NARRA_TG_DIGEST_EVERY_S ?? 1800), commands: (env.NARRA_TG_COMMANDS ?? "on") !== "off", allowedChats: allowed.length ? new Set(allowed) : null };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const eth = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const ICON: Record<string, string> = { HOT: "🔥", "ROTATING IN": "🔥", EMERGING: "🟡", "ROTATING OUT": "🟣", COOLING: "🔵", DEAD: "⚫", IN: "🟢", EDGE: "🟡", OUT: "🟣", ORPHAN: "⚪", NOT_PONS: "🚫" };
const FOOT = "\n<i>IN = belongs to a live meta, not a recommendation</i>";

/** The board in ten lines: totals, hottest, draining, narratives, top 5. */
export function formatDigest(r: NowOut, top = 5): string {
  const cl = r.clusters.filter((k) => k.status !== "DEAD");
  if (!cl.length) return `<b>narra · ${r.window}</b>\nno live meta right now — ${r.counts.launches} launches, none clustered`;
  const ethSum = cl.reduce((s, k) => s + k.heat.quote_norm_in, 0);
  const hot = [...cl].sort((a, b) => b.heat.quote_norm_in - a.heat.quote_norm_in)[0];
  const drain = [...cl].sort((a, b) => b.flow.out_wallets - a.flow.out_wallets)[0];
  const byNar = new Map<string, number>(); for (const k of cl) byNar.set(k.narrative, (byNar.get(k.narrative) ?? 0) + k.heat.quote_norm_in);
  const nar = [...byNar].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${Math.round((v / (ethSum || 1)) * 100)}%`).join(" · ");
  const L = [`<b>narra · what's printing on Pons · ${r.window}</b>`, `${cl.length} metas · ${eth(ethSum)} ETH · ${cl.reduce((s, k) => s + k.heat.unique_buyers, 0).toLocaleString("en-US")} buyers`, "",
    `hottest  <b>${esc(hot.slug)}</b> ${ICON[hot.status] ?? ""} ${eth(hot.heat.quote_norm_in)} ETH · ${hot.heat.unique_buyers} buyers`];
  if (drain && drain.flow.out_wallets >= 8) L.push(`draining <b>${esc(drain.slug)}</b> — ${drain.flow.out_wallets} wallets left`);
  L.push(`narratives ${esc(nar)}`, "");
  for (const k of cl.slice(0, top)) L.push(`${ICON[k.status] ?? "·"} <b>${esc(k.slug)}</b> ${k.status.toLowerCase()} · ${k.heat.n_launches} CA · ${eth(k.heat.quote_norm_in)} ETH · ${k.heat.unique_buyers} buyers${k.rotating_from ? ` · ← ${esc(k.rotating_from)}` : ""}`);
  L.push("", "/coin 0x… · /find word · /flow · /trend");
  return L.join("\n");
}

/** The card, shortened: verdict, meta, popularity, two reasons, one watch-out. */
export function formatCoin(r: CoinOut | NotPonsOut): string {
  if (r.verdict === "NOT_PONS") return `${ICON.NOT_PONS} <code>${esc(r.token)}</code>\nnot a Pons v2 launch`;
  const L = [`<b>${esc(r.symbol ? "$" + r.symbol : r.name || "(no symbol)")}</b> · ${r.phase}${r.curve && r.phase === "curve" ? ` ${r.curve.real_quote_eth?.toFixed(2) ?? "?"}/${r.curve.threshold_eth} ${esc(r.pair.symbol)}` : ""}`, `<code>${esc(r.token)}</code>`, "",
    `${ICON[r.verdict] ?? ""} <b>${r.verdict}</b>${r.cluster ? ` · ${esc(r.cluster.slug)} ${r.cluster.membership.toFixed(2)} (${r.cluster.status.toLowerCase()})` : ""}`];
  if (r.popularity?.cluster_rank) L.push(`meta #${r.popularity.cluster_rank} of ${r.popularity.clusters_total} · ${r.popularity.rank_in_cluster ? `#${r.popularity.rank_in_cluster} of ${r.popularity.cluster_size} inside` : "joins it by wallets"} · ${r.popularity.buyers} buyers`);
  const reasons = r.reasons.filter((x) => !x.startsWith("popularity:")).slice(0, 2);
  if (reasons.length) { L.push(""); for (const s of reasons) L.push(`· ${esc(s)}`); }
  if (r.watch.length) L.push(`⚠ ${esc(r.watch[0])}`);
  return L.join("\n") + FOOT;
}

export function formatFind(r: { query: string; clusters: { slug: string; status: string; narrative: string; eth: number; buyers: number }[]; tokens: { token: string; symbol: string; cluster: string | null; buyers: number }[] }): string {
  const L = [`<b>find "${esc(r.query)}"</b>`];
  for (const c of r.clusters.slice(0, 5)) L.push(`${ICON[c.status] ?? "·"} ${esc(c.slug)} · ${c.narrative} · ${eth(c.eth)} ETH · ${c.buyers} buyers`);
  for (const t of r.tokens.slice(0, 5)) L.push(`<code>${esc(t.token.slice(0, 10))}…</code> ${esc(t.symbol ? "$" + t.symbol : "?")} · ${t.buyers} buyers${t.cluster ? " · " + esc(t.cluster) : ""}`);
  if (L.length === 1) L.push("nothing in this window");
  return L.join("\n");
}

export function formatFlow(r: FlowOut): string {
  if (!r.edges.length) return "<b>flow</b>\nno rotation above threshold in this window";
  return ["<b>flow · where repeat buyers moved</b>", ...r.edges.slice(0, 8).map((e) => `${esc(e.from)} → <b>${esc(e.to)}</b> · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH`)].join("\n");
}

export function formatTrend(t: { hours: number; step: number; narratives: string[]; rows: { from: string; eth: number; narratives: Record<string, number> }[] }): string {
  const L = [`<b>trend · last ${t.hours}h, ${t.step}h steps</b>`];
  for (const r of t.rows.slice(-6)) { const top = Object.entries(r.narratives).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}%`).join(" · "); L.push(`${r.from.slice(5, 16).replace("T", " ")} · ${eth(r.eth)} ETH · ${esc(top)}`); }
  return L.join("\n");
}

export interface BotApi {
  now(window: "15m" | "60m" | "4h"): Promise<NowOut | null>;
  coin(address: string): Promise<CoinOut | NotPonsOut | null>;
  find(q: string): Promise<Parameters<typeof formatFind>[0] | null>;
  flow(): Promise<FlowOut | null>;
  trend(): Promise<Parameters<typeof formatTrend>[0] | null>;
}

export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = text.trim().match(/^\/([a-z]+)(?:@\w+)?(?:\s+(.*))?$/i);
  if (m) return { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() };
  if (/^0x[0-9a-fA-F]{40}$/.test(text.trim())) return { cmd: "coin", arg: text.trim() };
  return null;
}

export class CommunityBot {
  private offset = 0;
  private stopped = false;
  private perUser = new RateLimiter(10);
  sent = 0; errors = 0;
  constructor(private cfg: BotConfig, private api: BotApi, private fetchFn: typeof fetch = fetch) {}

  async send(chat: string | number, text: string): Promise<void> {
    try {
      const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
      if (r.ok) this.sent++; else this.errors++;
    } catch { this.errors++; }
  }

  async answer(text: string): Promise<string | null> {
    const p = parseCommand(text); if (!p) return null;
    switch (p.cmd) {
      case "meta": case "now": case "board": { const w = p.arg === "15m" || p.arg === "4h" ? p.arg : "60m"; const r = await this.api.now(w); return r ? formatDigest(r) : "warming up, try again in a minute"; }
      case "coin": { if (!/^0x[0-9a-fA-F]{40}$/.test(p.arg)) return "usage: /coin 0x… (a Pons v2 contract address)"; const r = await this.api.coin(p.arg); return r ? formatCoin(r) : "warming up"; }
      case "find": { if (!p.arg) return "usage: /find word"; const r = await this.api.find(p.arg); return r ? formatFind(r) : "warming up"; }
      case "flow": { const r = await this.api.flow(); return r ? formatFlow(r) : "warming up"; }
      case "trend": { const r = await this.api.trend(); return r ? formatTrend(r) : "warming up"; }
      case "help": case "start": return "<b>narra</b> — which meta is printing on Pons right now\n/meta [15m|60m|4h] — the board\n/coin 0x… — is this token in a live meta\n/find word — search metas and tokens\n/flow — where repeat buyers moved\n/trend — narratives over the last two days" + FOOT;
      default: return null;
    }
  }

  async handle(update: { message?: { text?: string; chat: { id: number | string }; from?: { id: number } } }): Promise<void> {
    const m = update.message; if (!m?.text || !this.cfg.commands) return;
    if (this.cfg.allowedChats && !this.cfg.allowedChats.has(String(m.chat.id))) return;
    if (!this.perUser.allow(String(m.from?.id ?? m.chat.id))) return;
    const reply = await this.answer(m.text);
    if (reply) await this.send(m.chat.id, reply);
  }

  async digest(): Promise<void> {
    if (!this.cfg.communityChats.length) return;
    const r = await this.api.now("60m"); if (!r) return;
    const text = formatDigest(r);
    for (const chat of this.cfg.communityChats) await this.send(chat, text);
  }

  start(): void {
    void (async () => {
      let nextDigest = Date.now() + 60_000; // first digest a minute in, once the engine is warm
      while (!this.stopped) {
        try {
          const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/getUpdates?offset=${this.offset}&timeout=25&allowed_updates=%5B%22message%22%5D`, { signal: AbortSignal.timeout(35_000) });
          const j = (await r.json()) as { ok: boolean; result?: { update_id: number; message?: { text?: string; chat: { id: number }; from?: { id: number } } }[] };
          for (const u of j.result ?? []) { this.offset = u.update_id + 1; await this.handle(u); }
        } catch { this.errors++; await new Promise((res) => setTimeout(res, 5_000)); }
        if (Date.now() >= nextDigest) { nextDigest = Date.now() + this.cfg.digestEverySec * 1000; await this.digest(); }
      }
    })();
  }
  stop(): void { this.stopped = true; }
}
