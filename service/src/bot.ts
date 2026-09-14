/**
 * The community bot. A reduced view of the board for a Telegram group or channel: a digest every N minutes and
 * five commands that answer from the same cached analysis the site uses. No wallets, no history, no gate —
 * the point is to keep the chat looking at the same numbers as the terminal and the site.
 *
 * Long polling (getUpdates), so no public webhook is needed.
 */
import type { NowOut, CoinOut, NotPonsOut, FlowOut, WhyOut } from "narra-cli";
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

/** The board: reading first, then the top five, then the commands. */
export function formatDigest(r: NowOut, top = 5): string {
  const cl = r.clusters.filter((k) => k.status !== "DEAD");
  const head = `<b>narra · what's printing on Pons · ${r.window}</b> <i>${new Date().toISOString().slice(11, 16)} UTC</i>`;
  if (!cl.length) return `${head}\n\nno live meta right now — ${r.counts.launches} launches, none clustered`;
  const S: string[][] = [[head]];
  if (r.reading) S.push(r.reading.split(/(?<=\.)\s+(?=[A-Z0-9])/).map(esc));
  S.push(cl.slice(0, top).map((k) => `${ICON[k.status] ?? "·"} <b>${esc(k.slug)}</b> · ${k.status.toLowerCase()} · ${esc(k.narrative)}${k.narrative_sub ? "·" + esc(k.narrative_sub) : ""}\n    ${k.heat.n_launches} CA · ${eth(k.heat.quote_norm_in)} ETH · ${k.heat.unique_buyers} buyers${k.flow.in_wallets ? ` · ⇦${k.flow.in_wallets}` : ""}${k.flow.out_wallets ? ` · ⇨${k.flow.out_wallets}` : ""}${k.rotating_from ? ` · from ${esc(k.rotating_from)}` : ""}`));
  S.push(["/coin 0x… · /why meta · /find word · /flow · /trend"]);
  return S.map((x) => x.join("\n")).join("\n\n");
}

/** What makes a digest worth re-posting: the top five and their statuses, the hottest and the draining meta. */
export function digestSignature(r: NowOut, top = 5): string {
  const cl = r.clusters.filter((k) => k.status !== "DEAD");
  const hot = [...cl].sort((a, b) => b.heat.quote_norm_in - a.heat.quote_norm_in)[0]?.slug ?? "";
  const drain = [...cl].sort((a, b) => b.flow.out_wallets - a.flow.out_wallets)[0];
  return [hot, drain && drain.flow.out_wallets >= 8 ? drain.slug : "", ...cl.slice(0, top).map((k) => `${k.slug}:${k.status}`)].join("|");
}

/** A meta: reading, numbers, what holds it, flow, tags, members — as sections. */
export function formatWhy(r: WhyOut): string {
  const k = r.cluster, h = k.heat;
  const S: string[][] = [[`<b>${esc(k.slug)}</b> ${ICON[k.status] ?? ""} ${k.status.toLowerCase()} · ${esc(k.narrative)}${k.narrative_sub ? " · " + esc(k.narrative_sub) : ""} · #${k.rank} on the board`, ...(k.summary ? [`<i>${esc(k.summary)}</i>`] : [])]];
  if (r.reading) S.push(r.reading.split(/(?<=\.)\s+(?=[A-Z0-9])/).map(esc));
  S.push([`📊 ${h.n_launches} CA · ${k.n_members} members · ${h.n_alive} alive · ${eth(h.quote_norm_in)} ETH · ${h.unique_buyers} buyers · ${h.n_graduated} grad · ${Math.round(h.graduated_share * 100)}% in pool`, `🧩 ${k.links.text} name · ${k.links.semantic} meaning · ${k.links.wallet} wallet · ${k.links.deployer} deployer links`]);
  const flow: string[] = [];
  for (const e of r.edges_in.slice(0, 2)) flow.push(`⇦ ${esc(e.from)} · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH`);
  for (const e of r.edges_out.slice(0, 2)) flow.push(`⇨ ${esc(e.to)} · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH`);
  if (flow.length) S.push(["🔁 <b>flow</b>", ...flow]);
  if (r.tags.length) S.push([`📝 tags: ${esc(r.tags.map((t) => t.tag).slice(0, 6).join(" "))}`]);
  const members = (k.members ?? []).slice(0, 6).map((m) => `${esc(m.symbol ? "$" + m.symbol : m.token.slice(0, 8))} ${m.membership.toFixed(2)}`);
  if (members.length) S.push(["👛 <b>members</b>", members.join(" · ")]);
  return S.map((x) => x.join("\n")).join("\n\n");
}

const ago = (ts: number, now = Date.now() / 1000) => { const m = Math.max(0, Math.round((now - ts) / 60)); return m < 90 ? `${m}m old` : m < 2880 ? `${(m / 60).toFixed(1)}h old` : `${Math.round(m / 1440)}d old`; };

/** The card in sections: what it is, the verdict, activity, who is buying, why, words. Blank lines between sections. */
export function formatCoin(r: CoinOut | NotPonsOut): string {
  if (r.verdict === "NOT_PONS") return `${ICON.NOT_PONS} <code>${esc(r.token)}</code>\nnot a Pons v2 launch`;
  const stage = r.phase === "pool" ? "in the pool" : r.phase === "swept" ? "swept, pool not open" : r.curve?.progress != null ? `curve ${Math.round(r.curve.progress * 100)}% → graduation` : "on the curve";
  const S: string[][] = [];
  S.push([`<b>${esc(r.symbol ? "$" + r.symbol : r.name || "(no symbol)")}</b> · ${stage} · ${esc(r.pair.symbol)} pair · ${ago(r.launched_at)}`, `<code>${esc(r.token)}</code>`]);
  const v: string[] = [];
  if (r.cluster) {
    v.push(`${ICON[r.verdict] ?? ""} <b>${r.verdict}</b> — ${esc(r.cluster.slug)} ${r.cluster.membership.toFixed(2)} · ${r.cluster.status.toLowerCase()}`);
    if (r.popularity?.cluster_rank) v.push(`meta #${r.popularity.cluster_rank} of ${r.popularity.clusters_total} · ${r.popularity.rank_in_cluster ? `token #${r.popularity.rank_in_cluster} of ${r.popularity.cluster_size} inside` : "joins it by wallets, not by name"}`);
  } else {
    v.push(`${ICON[r.verdict] ?? ""} <b>${r.verdict}</b> — standalone, no live meta around it`);
    const n = r.nearest.filter((x) => x.membership >= 0.1).slice(0, 2);
    if (n.length) v.push(`closest: ${n.map((x) => `${esc(x.slug)} ${x.membership.toFixed(2)} (${x.overlap} shared buyers)`).join(" · ")}`);
  }
  S.push(v);
  const a = r.activity;
  const act = [`📈 <b>activity</b>`];
  act.push(a.buyers_60m ? `${a.buys_10m} buys · ${a.buyers_10m} buyers in 10m` : `no buys in the last hour${a.last_trade_ts ? " · last trade " + ago(a.last_trade_ts).replace(" old", " ago") : ""}`);
  if (a.buyers_60m) act.push(`${a.buys_60m} buys · ${a.sells_60m} sells · ${a.buyers_60m} buyers · ${eth(a.eth_in_60m)} ETH in 60m`);
  if (r.popularity && r.popularity.buyers > 0) act.push(`more buyers than ${r.popularity.buyers_percentile}% of tokens in the window`);
  S.push(act);
  const ec = r.early_cohorts;
  const bits: string[] = [];
  if (ec.total >= 5) {
    if (ec["early-in-hot"] >= 3) bits.push(`${ec["early-in-hot"]} early-in-hot`);
    if (ec.rotator >= 3) bits.push(`${ec.rotator} rotators`);
    if (ec.sniper / ec.total >= 0.3) bits.push(`${Math.round((ec.sniper / ec.total) * 100)}% snipers`);
    if (ec.sprayer / ec.total >= 0.3) bits.push(`${Math.round((ec.sprayer / ec.total) * 100)}% sprayer bots`);
  }
  if (bits.length || r.deployer_launches_window >= 5) S.push([`👥 <b>early buyers</b> (${ec.total})`, ...(bits.length ? [bits.join(" · ")] : []), ...(r.deployer_launches_window >= 5 ? [`deployer is a launch farm: ${r.deployer_launches_window} tokens this window`] : [])]);
  const why = r.reasons.filter((x) => !x.startsWith("popularity:") && !/^cluster .* is /.test(x) && !/^no live cluster/.test(x)).slice(0, 2);
  const watch = r.watch.filter((x) => !/launch farm/.test(x)).slice(0, 2);
  if (why.length || watch.length) S.push([`🔎 <b>why</b>`, ...why.map((x) => `· ${esc(x)}`), ...watch.map((x) => `⚠ ${esc(x)}`)]);
  if (r.narratives.length || r.words.length) S.push([`📝 words: ${esc(r.words.slice(0, 6).join(" "))}${r.narratives.length ? ` → ${esc(r.narratives.join(", "))}` : ""}`]);
  return S.map((sec) => sec.join("\n")).join("\n\n") + "\n" + FOOT;
}

export function formatFind(r: { query: string; clusters: { slug: string; status: string; narrative: string; eth: number; buyers: number }[]; tokens: { token: string; symbol: string; cluster: string | null; buyers: number }[] }): string {
  const S: string[][] = [[`<b>find "${esc(r.query)}"</b>`]];
  if (r.clusters.length) S.push(["🗂 <b>metas</b>", ...r.clusters.slice(0, 5).map((c) => `${ICON[c.status] ?? "·"} ${esc(c.slug)} · ${esc(c.narrative)} · ${eth(c.eth)} ETH · ${c.buyers} buyers`)]);
  if (r.tokens.length) S.push(["🪙 <b>tokens</b>", ...r.tokens.slice(0, 5).map((t) => `${esc(t.symbol ? "$" + t.symbol : "?")} <code>${esc(t.token.slice(0, 10))}…</code> · ${t.buyers} buyers${t.cluster ? " · in " + esc(t.cluster) : " · no meta"}`)]);
  if (S.length === 1) S.push(["nothing in this window matches"]);
  else S.push(["/why meta · /coin 0x…"]);
  return S.map((x) => x.join("\n")).join("\n\n");
}

export function formatFlow(r: FlowOut): string {
  const S: string[][] = [[`<b>flow · where repeat buyers moved · ${r.window}</b>`]];
  if (r.reading) S.push(r.reading.split(/(?<=\.)\s+(?=[A-Z0-9])/).map(esc));
  if (!r.edges.length) return S.map((x) => x.join("\n")).join("\n\n");
  S.push(r.edges.slice(0, 8).map((e) => `${esc(e.from)} → <b>${esc(e.to)}</b> · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH${e.deployers ? ` · ${e.deployers} deployers` : ""}`));
  return S.map((x) => x.join("\n")).join("\n\n");
}

export function formatTrend(t: { hours: number; step: number; narratives: string[]; reading?: string; rows: { from: string; eth: number; narratives: Record<string, number> }[] }): string {
  const S: string[][] = [[`<b>trend · last ${t.hours}h, ${t.step}h steps</b>`]];
  if (t.reading) S.push(t.reading.split(/(?<=\.)\s+(?=[A-Z0-9])/).map(esc));
  S.push(t.rows.slice(-6).map((r) => { const top = Object.entries(r.narratives).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}%`).join(" · "); return `${r.from.slice(5, 16).replace("T", " ")} · ${eth(r.eth)} ETH · ${esc(top)}`; }));
  return S.map((x) => x.join("\n")).join("\n\n");
}

export interface BotApi {
  now(window: "15m" | "60m" | "4h"): Promise<NowOut | null>;
  why(slug: string): Promise<WhyOut | null>;
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
  /** The last Telegram refusal, and when getUpdates last succeeded: a stuck poll shows up as a growing poll age in health. */
  lastError = "";
  lastPollAt = 0;
  /** Chats the bot has heard from since start (id, type, title): health shows them so the digest chat id can be copied, not guessed. */
  seenChats = new Map<string, { type: string; title: string; at: number }>();
  constructor(private cfg: BotConfig, private api: BotApi, private fetchFn: typeof fetch = fetch) {}

  private pausedUntil = 0;
  async send(chat: string | number, text: string, replyTo?: number): Promise<void> {
    if (Date.now() < this.pausedUntil) { this.errors++; return; }
    try {
      const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) }), signal: AbortSignal.timeout(10_000) });
      if (r.ok) { this.sent++; return; }
      this.errors++;
      this.lastError = `${r.status} ${((await r.clone().json().catch(() => ({}))) as { description?: string }).description ?? ""}`.trim();
      if (r.status === 429) { const j = (await r.json().catch(() => ({}))) as { parameters?: { retry_after?: number } }; this.pausedUntil = Date.now() + ((j.parameters?.retry_after ?? 5) * 1000); }
    } catch (e) { this.errors++; this.lastError = (e as Error).message; }
  }

  async answer(text: string): Promise<string | null> {
    const p = parseCommand(text); if (!p) return null;
    switch (p.cmd) {
      case "meta": case "now": case "board": { const w = p.arg === "15m" || p.arg === "4h" ? p.arg : "60m"; const r = await this.api.now(w); return r ? formatDigest(r) : "warming up, try again in a minute"; }
      case "coin": {
        const addrs = (p.arg.match(/0x[0-9a-fA-F]{40}/g) ?? []).slice(0, 3);
        if (!addrs.length) return "usage: /coin 0x… (up to three Pons v2 contract addresses)";
        const cards: string[] = [];
        for (const a of addrs) { const r = await this.api.coin(a); cards.push(r ? formatCoin(r).replace(FOOT, "") : "warming up"); }
        return cards.join("\n\n") + FOOT;
      }
      case "why": case "meta_why": { if (!p.arg) return "usage: /why meta-slug (or any word from its name)"; try { const r = await this.api.why(p.arg); return r ? formatWhy(r) : "no such meta in this window; try /find"; } catch (e) { return esc((e as Error).message); } }
      case "find": { if (!p.arg) return "usage: /find word"; const r = await this.api.find(p.arg); return r ? formatFind(r) : "warming up"; }
      case "flow": { const r = await this.api.flow(); return r ? formatFlow(r) : "warming up"; }
      case "trend": { const r = await this.api.trend(); return r ? formatTrend(r) : "warming up"; }
      case "help": case "start": return "<b>narra</b> — which meta is printing on Pons right now\n/meta [15m|60m|4h] — the board\n/coin 0x… — is this token in a live meta\n/why meta — what holds a meta together\n/find word — search metas and tokens\n/flow — where repeat buyers moved\n/trend — narratives over the last two days" + FOOT;
      default: return null;
    }
  }

  async handle(update: { message?: { message_id?: number; text?: string; chat: { id: number | string; type?: string; title?: string; username?: string }; from?: { id: number } } }): Promise<void> {
    const m = update.message; if (!m) return;
    this.seenChats.set(String(m.chat.id), { type: m.chat.type ?? "?", title: m.chat.title ?? m.chat.username ?? "", at: Date.now() });
    if (!m.text || !this.cfg.commands) return;
    if (this.cfg.allowedChats && !this.cfg.allowedChats.has(String(m.chat.id))) return;
    if (!this.perUser.allow(String(m.from?.id ?? m.chat.id))) return;
    const reply = await this.answer(m.text);
    if (reply) await this.send(m.chat.id, reply, m.chat.type && m.chat.type !== "private" ? m.message_id : undefined);
  }

  private lastSignature = "";
  private lastDigestAt = 0;
  /** Posts when the board changed (top five, statuses, hottest, draining) and at least every `maxGapSec` regardless. */
  async digest(now = Date.now(), maxGapSec = this.cfg.digestEverySec * 4): Promise<boolean> {
    if (!this.cfg.communityChats.length) return false;
    const r = await this.api.now("60m"); if (!r) return false;
    const sig = digestSignature(r);
    const changed = sig !== this.lastSignature;
    if (!changed && now - this.lastDigestAt < maxGapSec * 1000) return false;
    this.lastSignature = sig; this.lastDigestAt = now;
    const text = formatDigest(r);
    for (const chat of this.cfg.communityChats) await this.send(chat, text);
    return true;
  }

  start(): void {
    void (async () => {
      let nextDigest = Date.now() + 60_000; // first digest a minute in, once the engine is warm
      while (!this.stopped) {
        try {
          const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/getUpdates?offset=${this.offset}&timeout=25&allowed_updates=%5B%22message%22%5D`, { signal: AbortSignal.timeout(35_000) });
          const j = (await r.json()) as { ok: boolean; description?: string; result?: { update_id: number; message?: { text?: string; chat: { id: number }; from?: { id: number } } }[] };
          if (!j.ok) { this.errors++; this.lastError = `getUpdates ${r.status} ${j.description ?? ""}`.trim(); await new Promise((res) => setTimeout(res, 5_000)); continue; }
          this.lastPollAt = Date.now();
          for (const u of j.result ?? []) { this.offset = u.update_id + 1; await this.handle(u as Parameters<CommunityBot["handle"]>[0]); }
        } catch (e) { this.errors++; this.lastError = `getUpdates ${(e as Error).message}`; await new Promise((res) => setTimeout(res, 5_000)); }
        if (Date.now() >= nextDigest) { nextDigest = Date.now() + this.cfg.digestEverySec * 1000; await this.digest(); }
      }
    })();
  }
  stop(): void { this.stopped = true; }
}
