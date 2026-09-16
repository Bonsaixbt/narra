/**
 * The community bot. A compact view of the board for a Telegram group: a digest when the board changes (at most
 * once per interval, at least once per eight), and commands that answer from the same cached analysis the site
 * uses. Cards read like a scanner bot's: one line per fact, an emoji per line, the address in a code block, buttons
 * under it. Nothing here is a recommendation and the footer says so.
 *
 * Long polling (getUpdates), so no public webhook is needed.
 */
import type { NowOut, CoinOut, NotPonsOut, FlowOut, WhyOut, WalletOut } from "narrahood";
import { RateLimiter } from "./ratelimit.js";

export interface BotConfig { token: string; communityChats: string[]; digestEverySec: number; commands: boolean; allowedChats: Set<string> | null }

export function botConfig(env: NodeJS.ProcessEnv = process.env): BotConfig | null {
  const token = env.NARRA_TG_BOT_TOKEN ?? "";
  if (!token) return null;
  const communityChats = (env.NARRA_TG_COMMUNITY_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = (env.NARRA_TG_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { token, communityChats, digestEverySec: Number(env.NARRA_TG_DIGEST_EVERY_S ?? 3600), commands: (env.NARRA_TG_COMMANDS ?? "on") !== "off", allowedChats: allowed.length ? new Set(allowed) : null };
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
/** Links into the site when it is configured (NARRA_SITE_URL, else NARRA_API_ORIGIN); plain text otherwise. */
export const SITE = { url: (process.env.NARRA_SITE_URL ?? process.env.NARRA_API_ORIGIN ?? "").replace(/\/$/, "") };
export const metaLink = (slug: string) => (SITE.url ? `<a href="${SITE.url}/cluster/${encodeURIComponent(slug)}">${esc(slug)}</a>` : esc(slug));
export const coinLink = (token: string, label: string) => (SITE.url ? `<a href="${SITE.url}/coin/${token}">${esc(label)}</a>` : esc(label));
const EXPLORER = "https://robinhoodchain.blockscout.com";
const eth = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const n = (v: number) => v.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ICON: Record<string, string> = { HOT: "🔥", "ROTATING IN": "🔥", EMERGING: "🟡", "ROTATING OUT": "🟣", COOLING: "🔵", DEAD: "⚫", IN: "🟢", EDGE: "🟡", OUT: "🟣", ORPHAN: "⚪", NOT_PONS: "🚫" };
const FOOT = "<i>IN = belongs to a live meta, not a recommendation</i>";
const sentences = (s: string) => s.split(/(?<=\.)\s+(?=[A-Z0-9])/).map(esc);

export type Button = { text: string; url: string };
export interface Reply { text: string; buttons?: Button[][] }

const boardButtons = (): Button[][] => (SITE.url ? [[{ text: "board", url: `${SITE.url}/` }, { text: "flow", url: `${SITE.url}/flow` }, { text: "wallets", url: `${SITE.url}/wallets` }]] : []);
const metaButtons = (slug: string): Button[][] => (SITE.url ? [[{ text: "meta", url: `${SITE.url}/cluster/${encodeURIComponent(slug)}` }, { text: "flow", url: `${SITE.url}/flow` }]] : []);
const coinButtons = (token: string, slug: string | null): Button[][] => {
  const row: Button[] = [];
  if (SITE.url) row.push({ text: "card", url: `${SITE.url}/coin/${token}` });
  if (SITE.url && slug) row.push({ text: "meta", url: `${SITE.url}/cluster/${encodeURIComponent(slug)}` });
  row.push({ text: "explorer", url: `${EXPLORER}/token/${token}` });
  return [row];
};

/** The board: counts, the top metas one per line, the reading. */
export function formatDigest(r: NowOut, top = 6, only?: (k: NowOut["clusters"][number]) => boolean): Reply {
  const live = r.clusters.filter((k) => k.status !== "DEAD");
  const cl = only ? live.filter(only) : live;
  const time = new Date().toISOString().slice(11, 16);
  const liveEth = live.reduce((s, k) => s + k.heat.quote_norm_in, 0), liveBuyers = live.reduce((s, k) => s + k.heat.unique_buyers, 0);
  const head = [`📊 <b>Pons · last ${r.window}</b> · ${time} UTC`, `${n(r.counts.launches)} launches · ${live.length} live metas · ${eth(liveEth)} ETH · ${n(liveBuyers)} buyers`];
  if (!cl.length) return { text: head.join("\n") + `\n\n${only ? "nothing HOT right now" : "no live meta right now"} — ${n(r.counts.launches)} launches, none clustered`, buttons: boardButtons() };
  const rows = cl.slice(0, top).map((k, i) => {
    const flow = `${k.flow.in_wallets ? ` ⇦${k.flow.in_wallets}` : ""}${k.flow.out_wallets ? ` ⇨${k.flow.out_wallets}` : ""}`;
    const nar = k.narrative === "mixed" ? "" : ` · ${esc(k.narrative)}`;
    return `${ICON[k.status] ?? "·"} ${i + 1}. <b>${metaLink(k.slug)}</b> ${k.status.toLowerCase()}${nar}\n     ${eth(k.heat.quote_norm_in)} ETH · ${n(k.heat.unique_buyers)} buyers · ${k.heat.n_launches} CA${flow}`;
  });
  const S: string[][] = [head, rows];
  if (r.reading && !only) S.push([`<i>${sentences(r.reading).join(" ")}</i>`]);
  return { text: S.map((x) => x.join("\n")).join("\n\n"), buttons: boardButtons() };
}

/** What makes a digest worth re-posting: the top five and their statuses, the hottest and the draining meta. */
export function digestSignature(r: NowOut, top = 5): string {
  const cl = r.clusters.filter((k) => k.status !== "DEAD");
  const hot = [...cl].sort((a, b) => b.heat.quote_norm_in - a.heat.quote_norm_in)[0]?.slug ?? "";
  const drain = [...cl].sort((a, b) => b.flow.out_wallets - a.flow.out_wallets)[0];
  return [hot, drain && drain.flow.out_wallets >= 8 ? drain.slug : "", ...cl.slice(0, top).map((k) => `${k.slug}:${k.status}`)].join("|");
}

/** A meta: header, one line per fact, flow, tags, members. */
export function formatWhy(r: WhyOut): Reply {
  const k = r.cluster, h = k.heat;
  const S: string[][] = [[`${ICON[k.status] ?? ""} <b>${metaLink(k.slug)}</b> · ${k.status.toLowerCase()}${k.narrative === "mixed" ? "" : " · " + esc(k.narrative)}${k.narrative_sub ? " · " + esc(k.narrative_sub) : ""} · #${k.rank} on the board`, ...(k.summary ? [`<i>${esc(k.summary)}</i>`] : [])]];
  S.push([
    `💧 ${eth(h.quote_norm_in)} ETH in · ${n(h.unique_buyers)} buyers · ${h.n_launches} CA`,
    `🧬 ${k.n_members} members · ${h.n_alive} alive · ${h.n_graduated} graduated · ${Math.round(h.graduated_share * 100)}% in pool`,
    `🧩 held by ${k.links.wallet} wallet · ${k.links.text} name · ${k.links.semantic} meaning · ${k.links.deployer} deployer links`,
  ]);
  const flow: string[] = [];
  for (const e of r.edges_in.slice(0, 2)) flow.push(`⇦ ${metaLink(e.from)} · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH`);
  for (const e of r.edges_out.slice(0, 2)) flow.push(`⇨ ${metaLink(e.to)} · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH`);
  if (flow.length) S.push(flow);
  if (r.reading) S.push([`<i>${sentences(r.reading).join(" ")}</i>`]);
  const members = (k.members ?? []).slice(0, 6).map((m) => `${esc(m.symbol ? "$" + m.symbol : m.token.slice(0, 8))} ${m.membership.toFixed(2)}`);
  if (members.length) S.push([`👛 ${members.join(" · ")}`]);
  if (r.tags.length) S.push([`📝 ${esc(r.tags.map((t) => t.tag).slice(0, 6).join(" · "))}`]);
  return { text: S.map((x) => x.join("\n")).join("\n\n"), buttons: metaButtons(k.slug) };
}

const ago = (ts: number, now = Date.now() / 1000) => { const m = Math.max(0, Math.round((now - ts) / 60)); return m < 90 ? `${m}m` : m < 2880 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m / 1440)}d`; };

/** The card: one line per fact, the address in a code block, buttons under it. */
export function formatCoin(r: CoinOut | NotPonsOut, withFoot = true): Reply {
  if (r.verdict === "NOT_PONS") return { text: `${ICON.NOT_PONS} <code>${esc(r.token)}</code>\nnot a Pons v2 launch`, buttons: [[{ text: "explorer", url: `${EXPLORER}/token/${r.token}` }]] };
  const label = r.symbol ? "$" + r.symbol : r.name || "(no symbol)";
  const head = [`${ICON[r.verdict] ?? ""} <b>${coinLink(r.token, label)}</b>${r.name && r.name !== r.symbol ? ` · ${esc(r.name)}` : ""}`];
  if (r.cluster) {
    head.push(`<b>${r.verdict}</b> · ${metaLink(r.cluster.slug)} ${r.cluster.status.toLowerCase()} · membership ${r.cluster.membership.toFixed(2)}`);
    if (r.popularity?.cluster_rank) head.push(`🏷 meta #${r.popularity.cluster_rank} of ${r.popularity.clusters_total}${r.popularity.rank_in_cluster ? ` · token #${r.popularity.rank_in_cluster} of ${r.popularity.cluster_size} inside` : " · joins it by wallets, not by name"}${r.narratives.length ? ` · ${esc(r.narratives[0])}` : ""}`);
  } else {
    head.push(`<b>${r.verdict}</b> · standalone, no live meta around it`);
    const near = r.nearest.filter((x) => x.membership >= 0.1).slice(0, 2);
    if (near.length) head.push(`🏷 closest: ${near.map((x) => `${metaLink(x.slug)} ${x.membership.toFixed(2)}`).join(" · ")}`);
  }
  const a = r.activity;
  const facts: string[] = [];
  facts.push(a.buyers_60m ? `💧 ${eth(a.eth_in_60m)} ETH · ${n(a.buyers_60m)} buyers · ${a.buys_60m} buys / ${a.sells_60m} sells · 60m` : `💧 no buys in the last hour${a.last_trade_ts ? ` · last trade ${ago(a.last_trade_ts)} ago` : ""}`);
  if (a.buys_10m) facts.push(`⚡ ${a.buys_10m} buys · ${a.buyers_10m} buyers in the last 10m`);
  const ec = r.early_cohorts;
  if (ec.total >= 3) {
    const bits: string[] = [];
    if (r.cluster) { const m = r.reasons.find((x) => /^\d+\/\d+ early buyers also bought/.test(x)); if (m) bits.push(`${m.split(" ")[0]} also in the meta`); }
    if (ec["early-in-hot"]) bits.push(`${ec["early-in-hot"]} early-in-hot`);
    if (ec.rotator) bits.push(`${ec.rotator} rotators`);
    if (ec.sniper / ec.total >= 0.3) bits.push(`${Math.round((ec.sniper / ec.total) * 100)}% snipers`);
    if (ec.sprayer / ec.total >= 0.3) bits.push(`${Math.round((ec.sprayer / ec.total) * 100)}% sprayer bots`);
    facts.push(`👥 early ${ec.total}${bits.length ? ": " + bits.join(" · ") : ""}`);
  }
  if (r.popularity && r.popularity.buyers > 0) facts.push(`📈 more buyers than ${r.popularity.buyers_percentile}% of tokens in the window`);
  const stage = r.phase === "pool" ? "in the pool" : r.phase === "swept" ? "swept, pool not open" : r.curve?.progress != null ? `curve ${Math.round(r.curve.progress * 100)}% → graduation` : "on the curve";
  facts.push(`⏱ ${ago(r.launched_at)} old · ${stage} · ${esc(r.pair.symbol)} pair`);
  const watch = [...r.watch.slice(0, 2), ...(r.deployer_launches_window >= 5 ? [`deployer is a launch farm: ${r.deployer_launches_window} tokens this window`] : [])].slice(0, 2);
  const S: string[][] = [head, facts];
  if (watch.length) S.push(watch.map((x) => `⚠ ${esc(x)}`));
  S.push([`<code>${esc(r.token)}</code>${withFoot ? "\n" + FOOT : ""}`]);
  return { text: S.map((sec) => sec.join("\n")).join("\n\n"), buttons: coinButtons(r.token, r.cluster?.slug ?? null) };
}

export function formatFind(r: { query: string; clusters: { slug: string; status: string; narrative: string; eth: number; buyers: number }[]; tokens: { token: string; symbol: string; cluster: string | null; buyers: number }[] }): Reply {
  const S: string[][] = [[`🔎 <b>${esc(r.query)}</b>`]];
  if (r.clusters.length) S.push(r.clusters.slice(0, 5).map((c) => `${ICON[c.status] ?? "·"} ${metaLink(c.slug)} · ${c.status.toLowerCase()}${c.narrative === "mixed" ? "" : " · " + esc(c.narrative)} · ${eth(c.eth)} ETH · ${c.buyers} buyers`));
  if (r.tokens.length) S.push(r.tokens.slice(0, 5).map((t) => `🪙 ${esc(t.symbol ? "$" + t.symbol : "?")} · ${t.buyers} buyers · ${t.cluster ? "in " + metaLink(t.cluster) : "no meta"} · <code>${esc(t.token)}</code>`));
  if (S.length === 1) S.push(["nothing in this window matches"]);
  return { text: S.map((x) => x.join("\n")).join("\n\n") };
}

export function formatFlow(r: FlowOut): Reply {
  const S: string[][] = [[`🔁 <b>where repeat buyers moved · ${r.window}</b>`]];
  if (r.edges.length) S.push(r.edges.slice(0, 8).map((e) => `${metaLink(e.from)} → <b>${metaLink(e.to)}</b> · ${e.wallets} wallets · ${eth(e.quote_norm)} ETH${e.deployers ? ` · ${e.deployers} dev` : ""}`));
  if (r.reading) S.push([`<i>${sentences(r.reading).join(" ")}</i>`]);
  return { text: S.map((x) => x.join("\n")).join("\n\n"), buttons: SITE.url ? [[{ text: "flow", url: `${SITE.url}/flow` }]] : [] };
}

export function formatTrend(t: { hours: number; step: number; narratives: string[]; reading?: string; rows: { from: string; eth: number; narratives: Record<string, number> }[] }): Reply {
  const S: string[][] = [[`📈 <b>narratives · last ${t.hours}h, ${t.step}h steps</b>`]];
  S.push(t.rows.slice(-6).map((r) => { const top = Object.entries(r.narratives).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}%`).join(" · "); return `${r.from.slice(5, 16).replace("T", " ")} · ${eth(r.eth)} ETH · ${esc(top)}`; }));
  if (t.reading) S.push([`<i>${sentences(t.reading).join(" ")}</i>`]);
  return { text: S.map((x) => x.join("\n")).join("\n\n") };
}

export interface HistoryRow { ts: string; status: string; n_launches: number; quote_eth: number; buyers: number }
/** A meta's status changes, newest last: one line per change, the reading under it. */
export function formatHistory(slug: string, rows: HistoryRow[], reading?: string): Reply {
  if (!rows.length) return { text: `no snapshots of ${esc(slug)} in the last 24h; try /find ${esc(slug)}` };
  const changes: HistoryRow[] = []; let last = "";
  for (const r of rows) { if (r.status !== last) { changes.push(r); last = r.status; } }
  const lines = changes.slice(-7).map((r) => `${r.ts.slice(11, 16)} ${ICON[r.status] ?? "·"} ${r.status.toLowerCase()} · ${eth(r.quote_eth)} ETH · ${n(r.buyers)} buyers · ${r.n_launches} CA`);
  const S: string[][] = [[`🕰 <b>${metaLink(slug)}</b> · last 24h · ${rows.length} snapshots`], lines];
  if (reading) S.push([`<i>${sentences(reading).join(" ")}</i>`]);
  return { text: S.map((x) => x.join("\n")).join("\n\n"), buttons: metaButtons(slug) };
}

/** One wallet: its clusters, what it bought, which metas. No net figure: it would read as a profit claim. */
export function formatWallet(r: WalletOut): Reply {
  const s = r.stat;
  if (!s) return { text: `👛 <code>${esc(r.wallet)}</code>\n${esc(r.note || "no buys in this window")}`, buttons: [[{ text: "explorer", url: `${EXPLORER}/address/${r.wallet}` }]] };
  const S: string[][] = [[`👛 <b>${esc(short(r.wallet))}</b>${s.cohorts.length ? ` · ${s.cohorts.join(", ")}` : ""}`]];
  S.push([
    `💧 ${eth(s.quote_in)} ETH in · ${eth(s.quote_out)} ETH out · ${s.buys} buys / ${s.sells} sells · ${s.tokens} tokens`,
    `⏱ median entry ${s.median_entry_sec === null ? "—" : s.median_entry_sec < 60 ? `${s.median_entry_sec}s` : `${Math.round(s.median_entry_sec / 60)}m`} after launch · ${Math.round(s.fast_share * 100)}% of buys within 5s`,
    ...(s.clusters.length ? [`🏷 metas: ${s.clusters.slice(0, 6).map(metaLink).join(" · ")}`] : []),
  ]);
  const pos = r.positions.slice(0, 5).map((p: WalletOut["positions"][number]) => `${esc(p.symbol ? "$" + p.symbol : p.token.slice(0, 8))} · ${eth(p.quote_in)} ETH${p.cluster ? ` · ${metaLink(p.cluster)}` : ""}`);
  if (pos.length) S.push(pos);
  S.push([`<code>${esc(r.wallet)}</code>`]);
  return { text: S.map((x) => x.join("\n")).join("\n\n"), buttons: [[{ text: "explorer", url: `${EXPLORER}/address/${r.wallet}` }, ...(SITE.url ? [{ text: "wallets", url: `${SITE.url}/wallets` }] : [])]] };
}

/** The chain in one screen: launches, trades, metas, live money, the narrative mix. */
export function formatStats(r: NowOut): Reply {
  const live = r.clusters.filter((k) => k.status !== "DEAD");
  const hot = live.filter((k) => k.status === "HOT" || k.status === "ROTATING IN").length;
  const byNar = new Map<string, number>(); for (const k of live) byNar.set(k.narrative, (byNar.get(k.narrative) ?? 0) + k.heat.quote_norm_in);
  const total = live.reduce((s, k) => s + k.heat.quote_norm_in, 0) || 1;
  const nar = [...byNar].filter(([k]) => k !== "mixed").sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${esc(k)} ${Math.round((v / total) * 100)}%`).join(" · ");
  return { text: [`📊 <b>Pons · last ${r.window}</b>`, `🚀 ${n(r.counts.launches)} launches · ${n(r.counts.trades)} trades · ${n(r.counts.candidates)} tokens traded`, `🧬 ${r.clusters.length} metas · ${hot} hot · ${live.length - hot} emerging or cooling · ${n(r.counts.clustered)} tokens inside metas`, `💧 ${eth(total)} ETH into live metas · ${n(live.reduce((s, k) => s + k.heat.unique_buyers, 0))} buyers · ${r.counts.sprayers} sprayer bots ignored`, ...(nar ? [`📈 ${nar}`] : [])].join("\n"), buttons: boardButtons() };
}

export const HELP = [
  "<b>narra</b> — which meta is printing on Pons right now",
  "",
  "paste a CA — is this token in a live meta",
  "/meta [15m|60m|4h] — the board",
  "/hot — only what is HOT or rotating in",
  "/why meta — what holds a meta together",
  "/history meta — how it rose and faded",
  "/flow — where repeat buyers moved",
  "/wallet 0x… — one wallet's clusters and buys",
  "/find word — search metas and tokens",
  "/trend — narratives over the last two days",
  "/stats — the chain in one screen",
  "/alerts on|off — digests and alerts in this chat (admins)",
  "",
  FOOT,
].join("\n");

export interface BotApi {
  now(window: "15m" | "60m" | "4h"): Promise<NowOut | null>;
  why(slug: string): Promise<WhyOut | null>;
  coin(address: string): Promise<CoinOut | NotPonsOut | null>;
  find(q: string): Promise<Parameters<typeof formatFind>[0] | null>;
  flow(): Promise<FlowOut | null>;
  trend(): Promise<Parameters<typeof formatTrend>[0] | null>;
  history?(slug: string): Promise<{ rows: HistoryRow[]; reading?: string } | null>;
  wallet?(address: string): Promise<WalletOut | null>;
  /** persisted chat preferences (`alerts:<chat>` = "off"); in memory when absent */
  pref?: { get(key: string): string | undefined; set(key: string, value: string): void };
  isAdmin?(chat: string | number, user: number): Promise<boolean>;
}

export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const t = text.trim();
  const m = t.match(/^\/([a-z]+)(?:@\w+)?(?:\s+(.*))?$/i);
  if (m) return { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() };
  // a bare address, or a short message that carries one ("is 0x… legit?"): the card answers it
  const ca = t.match(/0x[0-9a-fA-F]{40}/);
  if (ca && t.length <= 160) return { cmd: "coin", arg: ca[0] };
  return null;
}

export class CommunityBot {
  private offset = 0;
  private stopped = false;
  private perUser = new RateLimiter(10);
  private prefs = new Map<string, string>();
  sent = 0; errors = 0;
  /** The last Telegram refusal, and when getUpdates last succeeded: a stuck poll shows up as a growing poll age in health. */
  lastError = "";
  lastPollAt = 0;
  /** Chats the bot has heard from since start (id, type, title): health shows them so the digest chat id can be copied, not guessed. */
  seenChats = new Map<string, { type: string; title: string; at: number }>();
  constructor(private cfg: BotConfig, private api: BotApi, private fetchFn: typeof fetch = fetch) {}

  /** Digests and alerts for this chat are switched off with /alerts off. */
  muted(chat: string | number): boolean { return (this.api.pref?.get(`alerts:${chat}`) ?? this.prefs.get(`alerts:${chat}`)) === "off"; }

  private pausedUntil = 0;
  async send(chat: string | number, reply: Reply | string, replyTo?: number): Promise<void> {
    if (Date.now() < this.pausedUntil) { this.errors++; return; }
    const r0 = typeof reply === "string" ? { text: reply } : reply;
    try {
      const body: Record<string, unknown> = { chat_id: chat, text: r0.text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true };
      if (replyTo) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
      if (r0.buttons?.length) body.reply_markup = { inline_keyboard: r0.buttons };
      const r = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      if (r.ok) { this.sent++; return; }
      this.errors++;
      this.lastError = `${r.status} ${((await r.clone().json().catch(() => ({}))) as { description?: string }).description ?? ""}`.trim();
      if (r.status === 429) { const j = (await r.json().catch(() => ({}))) as { parameters?: { retry_after?: number } }; this.pausedUntil = Date.now() + ((j.parameters?.retry_after ?? 5) * 1000); }
    } catch (e) { this.errors++; this.lastError = (e as Error).message; }
  }

  async answer(text: string, ctx: { chat: string | number; user?: number } = { chat: 0 }): Promise<Reply | null> {
    const p = parseCommand(text); if (!p) return null;
    const warming = { text: "warming up, try again in a minute" };
    switch (p.cmd) {
      case "meta": case "now": case "board": case "top": { const w = p.arg === "15m" || p.arg === "4h" ? p.arg : "60m"; const r = await this.api.now(w); return r ? formatDigest(r) : warming; }
      case "hot": { const r = await this.api.now("60m"); return r ? formatDigest(r, 8, (k) => k.status === "HOT" || k.status === "ROTATING IN") : warming; }
      case "coin": case "ca": case "check": {
        const addrs = (p.arg.match(/0x[0-9a-fA-F]{40}/g) ?? []).slice(0, 3);
        if (!addrs.length) return { text: "usage: /coin 0x… (up to three Pons v2 contract addresses), or just paste the address" };
        if (addrs.length === 1) { const r = await this.api.coin(addrs[0]); return r ? formatCoin(r) : warming; }
        const cards: string[] = []; let buttons: Button[][] = [];
        for (const a of addrs) { const r = await this.api.coin(a); const c = r ? formatCoin(r, false) : { text: "warming up" }; cards.push(c.text); if (!buttons.length && c.buttons) buttons = c.buttons; }
        return { text: cards.join("\n\n") + "\n" + FOOT, buttons };
      }
      case "why": case "meta_why": { if (!p.arg) return { text: "usage: /why meta (the slug or any word from its name)" }; try { const r = await this.api.why(p.arg); return r ? formatWhy(r) : { text: "no such meta in this window; try /find" }; } catch (e) { return { text: esc((e as Error).message) }; } }
      case "history": { if (!p.arg) return { text: "usage: /history meta" }; if (!this.api.history) return null; const r = await this.api.history(p.arg); return r ? formatHistory(p.arg, r.rows, r.reading) : warming; }
      case "wallet": { const a = p.arg.match(/0x[0-9a-fA-F]{40}/)?.[0]; if (!a) return { text: "usage: /wallet 0x…" }; if (!this.api.wallet) return null; const r = await this.api.wallet(a); return r ? formatWallet(r) : warming; }
      case "find": { if (!p.arg) return { text: "usage: /find word" }; const r = await this.api.find(p.arg); return r ? formatFind(r) : warming; }
      case "flow": { const r = await this.api.flow(); return r ? formatFlow(r) : warming; }
      case "trend": { const r = await this.api.trend(); return r ? formatTrend(r) : warming; }
      case "stats": { const r = await this.api.now("60m"); return r ? formatStats(r) : warming; }
      case "alerts": {
        const v = p.arg.toLowerCase();
        if (v !== "on" && v !== "off") return { text: `alerts in this chat are ${this.muted(ctx.chat) ? "off" : "on"} · /alerts on|off` };
        if (this.api.isAdmin && ctx.user !== undefined && !(await this.api.isAdmin(ctx.chat, ctx.user))) return { text: "only chat admins can change this" };
        const key = `alerts:${ctx.chat}`;
        if (this.api.pref) this.api.pref.set(key, v); else this.prefs.set(key, v);
        return { text: v === "off" ? "digests and alerts are off in this chat; commands still work" : "digests and alerts are on in this chat" };
      }
      case "help": case "start": return { text: HELP, buttons: boardButtons() };
      default: return null;
    }
  }

  async handle(update: { message?: { message_id?: number; text?: string; chat: { id: number | string; type?: string; title?: string; username?: string }; from?: { id: number } } }): Promise<void> {
    const m = update.message; if (!m) return;
    this.seenChats.set(String(m.chat.id), { type: m.chat.type ?? "?", title: m.chat.title ?? m.chat.username ?? "", at: Date.now() });
    if (!m.text || !this.cfg.commands) return;
    if (this.cfg.allowedChats && !this.cfg.allowedChats.has(String(m.chat.id))) return;
    if (!this.perUser.allow(String(m.from?.id ?? m.chat.id))) return;
    const reply = await this.answer(m.text, { chat: m.chat.id, user: m.from?.id });
    if (reply) await this.send(m.chat.id, reply, m.chat.type && m.chat.type !== "private" ? m.message_id : undefined);
  }

  private lastSignature = "";
  private lastDigestAt = 0;
  /** Posts when the board changed (top five, statuses, hottest, draining) and at least every `maxGapSec` regardless. */
  async digest(now = Date.now(), maxGapSec = this.cfg.digestEverySec * 8): Promise<boolean> {
    const chats = this.cfg.communityChats.filter((c) => !this.muted(c));
    if (!chats.length) return false;
    const r = await this.api.now("60m"); if (!r) return false;
    const sig = digestSignature(r);
    const changed = sig !== this.lastSignature;
    if (!changed && now - this.lastDigestAt < maxGapSec * 1000) return false;
    this.lastSignature = sig; this.lastDigestAt = now;
    const reply = formatDigest(r);
    for (const chat of chats) await this.send(chat, reply);
    return true;
  }

  /** The command menu Telegram shows under the "/" button. Best effort, once per start. */
  async registerCommands(): Promise<void> {
    const commands = [
      ["meta", "the board: which meta is printing"], ["hot", "only HOT and rotating in"], ["coin", "is this CA in a live meta"], ["why", "what holds a meta together"],
      ["history", "how a meta rose and faded"], ["flow", "where repeat buyers moved"], ["wallet", "one wallet's clusters and buys"], ["find", "search metas and tokens"],
      ["trend", "narratives over two days"], ["stats", "the chain in one screen"], ["alerts", "digests and alerts on|off (admins)"], ["help", "all commands"],
    ].map(([command, description]) => ({ command, description }));
    try { await this.fetchFn(`https://api.telegram.org/bot${this.cfg.token}/setMyCommands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commands }), signal: AbortSignal.timeout(10_000) }); } catch { /* the menu is cosmetic */ }
  }

  start(): void {
    void this.registerCommands();
    void (async () => {
      let nextDigest = Date.now() + 120_000; // first digest two minutes in, once the engine is warm
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
