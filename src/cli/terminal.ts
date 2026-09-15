/**
 * narra terminal — the full-screen view. One process: the board on the left, the selected meta on the right,
 * the live feed at the bottom, and a prompt to paste a contract address and get its card without leaving the screen.
 * No TUI library: alternate screen, raw keys, a redraw per tick. Everything shown is the same data as --json.
 */
import { emitKeypressEvents } from "node:readline";
import { appendFileSync } from "node:fs";
import type { Args } from "./args.js";
import { str, windowOf, type WindowKey } from "./args.js";
import { Narra } from "../narra.js";
import { c, STATUS_COLOR, VERDICT_COLOR, visibleWidth, short, ago, utc } from "./render.js";
import { fork, type ChildProcess } from "node:child_process";
import { diffEvents, renderEvent, type WatchState } from "./watch.js";
import type { Snapshot, WorkerReply, WorkerRequest } from "./worker.js";
import { liveTrigger } from "../ingest/live.js";
import { SCHEMA_VERSION, type WatchEvent, type CoinOut, type NotPonsOut } from "../schemas.js";
import type { ClusterOut } from "../analyze/types.js";

type View = "board" | "cluster" | "coin" | "flow" | "wallets" | "help";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
function fit(s: string, w: number): string {
  if (w <= 0) return "";
  const vw = visibleWidth(s);
  if (vw <= w) return s + " ".repeat(w - vw);
  // truncate on visible width; ANSI sequences are copied whole so a cut never lands inside one
  let out = "", n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\x1b") { const m = s.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/); if (m) { out += m[0]; i += m[0].length - 1; continue; } }
    const ch = s[i];
    const cp = s.codePointAt(i)!; const full = String.fromCodePoint(cp); if (full.length > 1) i++;
    const cw = visibleWidth(full);
    if (n + cw > w - 1) break;
    out += full; n += cw;
    void ch;
  }
  return out + "\x1b[0m…" + " ".repeat(Math.max(0, w - n - 1));
}
const bar = (v: number, max: number, w: number) => { const k = max > 0 ? Math.round((v / max) * w) : 0; return c.red("█".repeat(k)) + c.dim("░".repeat(Math.max(0, w - k))); };

export async function terminal(args: Args): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) { console.error("narra terminal needs an interactive TTY (use narra now / watch --jsonl for pipes)"); return 10; }
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  let window: WindowKey = windowOf(args.flags.window);
  const everySec = Number(str(args.flags.every) ?? 20);
  const out = process.stdout;
  let view: View = "board", sel = 0, scroll = 0, input: string | null = null, status = "syncing…";
  let a: Snapshot | null = null, head: number | null = null, coin: CoinOut | NotPonsOut | null = null, coinBusy = false;
  // the analysis runs in a child process so the keys never wait for a clustering pass
  const childArgs = ["__worker", ...(str(args.flags.db) ? ["--db", str(args.flags.db)!] : []), ...(str(args.flags.rpc) ? ["--rpc", str(args.flags.rpc)!] : [])];
  const child: ChildProcess = fork(process.argv[1], childArgs, { execArgv: process.execArgv.filter((x) => x !== "--eval" && x !== "-e"), stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  child.on("message", (m: WorkerReply) => { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error)); });
  child.on("exit", (code) => { for (const p of pending.values()) p.reject(new Error(`analysis process exited (${code})`)); pending.clear(); });
  type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
  const call = <T,>(req: Req): Promise<T> => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve: resolve as (v: unknown) => void, reject }); child.send({ ...req, id }); });
  const MIN_TICK_GAP_MS = 10_000;
  let lastTickEnd = 0;
  const events: WatchEvent[] = [];
  const state: WatchState = { statuses: new Map(), edges: new Set(), members: new Map(), phases: new Map(), seenLaunch: new Set(), first: true };
  let busy = false, dirty = true, stop = false, wake: (() => void) | null = null;

  const write = (s: string) => out.write(s);
  write("\x1b[?1049h\x1b[?25l"); // alt screen, hide cursor
  const cleanup = () => { write("\x1b[?25h\x1b[?1049l"); try { process.stdin.setRawMode(false); } catch { /* not raw */ } };

  const dbg = (m: string) => { if (process.env.NARRA_TUI_LOG) appendFileSync(process.env.NARRA_TUI_LOG, `${new Date().toISOString()} ${m}\n`); };
  const tick = async (why: string) => {
    if (busy) return; busy = true; status = `syncing (${why})…`; dirty = true; dbg(`tick start ${why}`);
    try {
      const snap = await call<Snapshot>({ op: "prepare", window, offline: !!args.flags.offline });
      a = snap; head = snap.head_block;
      const source = { clusters: snap.clusters, edges: snap.edges, launches: snap.launches, tokens: new Map(snap.launches.map((l) => [l.token, l])), membership: new Map(snap.launches.filter((l) => l.slug).map((l) => [l.token, l.slug!])) };
      for (const e of diffEvents(state, source, new Date().toISOString())) events.unshift(e);
      events.splice(60);
      status = `ok · head ${head} · ${a.clusters.length} metas · ${a.counts.launches} launches · ${a.counts.trades} trades`;
      if (sel >= a.clusters.length) sel = Math.max(0, a.clusters.length - 1);
      lastTickEnd = Date.now();
    } catch (e) { status = `error: ${(e as Error).message.split("\n")[0].slice(0, 80)}`; events.unshift({ schema_version: SCHEMA_VERSION, ts: new Date().toISOString(), type: "SYNC", note: status }); }
    busy = false; dirty = true; dbg("tick end");
  };
  const live = liveTrigger(n.clients.ws, () => { if (Date.now() - lastTickEnd >= MIN_TICK_GAP_MS) wake?.(); });
  const loop = (async () => {
    while (!stop) {
      await tick("timer");
      await new Promise<void>((r) => { const id = setTimeout(() => { wake = null; r(); }, everySec * 1000); wake = () => { clearTimeout(id); wake = null; r(); }; });
    }
  })();

  const lookup = async (ca: string) => {
    coinBusy = true; view = "coin"; coin = null; dirty = true;
    try { coin = await call<CoinOut | NotPonsOut>({ op: "coin", address: ca, window }); } catch (e) { status = `coin: ${(e as Error).message.split("\n")[0]}`; }
    coinBusy = false; dirty = true;
  };

  // ---------------------------------------------------------------- drawing
  const draw = () => {
    dirty = false; dbg(`draw view=${view} busy=${busy}`);
    const W = out.columns || 120, H = out.rows || 40;
    const L: string[] = [];
    const wl = window;
    L.push(fit(`${c.bold(" NARRA")} ${c.dim("terminal")}  ${utc()}  window ${c.bold(wl)}  ${c.dim(status)}  ${c.dim(live.health().mode)}`, W));
    L.push(fit(c.dim(" " + "─".repeat(W - 2)), W));
    const bodyH = Math.max(8, H - 2 - 8 - 1); // header 2, feed 8, footer 1
    const clusters = a?.clusters ?? [];
    if (view === "help") {
      for (const l of ["", "  ↑/↓ or j/k  move          enter/l  open meta        b/esc  back", "  c  paste a contract address → card       f  capital flow      W  wallets", "  w  cycle window 15m/60m/4h              r  refresh now       q  quit", "", "  IN means membership in a live meta. It is not a recommendation.", "  Every number here is the same as narra now/coin/flow --json."]) L.push(fit(l, W));
    } else if (view === "cluster" && a && clusters[sel]) {
      // one meta, full width: numbers, links, cohorts, flow, tags, then every member
      const k = clusters[sel]; const h = k.heat;
      const lines: string[] = [];
      lines.push(` ${c.bold(k.slug)}  ${STATUS_COLOR[k.status]?.(k.status) ?? k.status}  ${c.cyan(k.narrative)}${k.narrative_sub ? c.dim(" · " + k.narrative_sub) : ""}  ${c.dim(`#${k.rank} of ${clusters.length}`)}`);
      if (k.summary) lines.push(` ${c.dim(k.summary)}`);
      lines.push(c.dim(` ${h.n_launches} CA · ${k.members.length} members · ${h.n_alive} alive · ${h.quote_norm_in.toFixed(2)} ETH in · ${h.unique_buyers} buyers · ${h.n_graduated} grad · ${Math.round(h.graduated_share * 100)}% in pool · fast buys ${Math.round(h.taxed_ratio * 100)}% · Δ ${h.delta_pct ?? "n/a"}%`));
      lines.push(c.dim(` links name ${k.links.text} · semantic ${k.links.semantic} · wallet ${k.links.wallet} · deployer ${k.links.deployer}${k.cohorts ? ` · cohorts snipers ${k.cohorts.sniper} · rotators ${k.cohorts.rotator} · early-in-hot ${k.cohorts["early-in-hot"]} · sprayers ${k.cohorts.sprayer}` : ""}`));
      const ein = a.edges.filter((e) => e.to === k.slug), eout = a.edges.filter((e) => e.from === k.slug);
      for (const e of ein.slice(0, 3)) lines.push(`  ⇦ ${fit(e.from, 24)} ${String(e.wallets).padStart(4)} wallets  ${e.quote_norm.toFixed(2)} ETH  ${e.deployers} dev`);
      for (const e of eout.slice(0, 3)) lines.push(`  ⇨ ${fit(e.to, 24)} ${String(e.wallets).padStart(4)} wallets  ${e.quote_norm.toFixed(2)} ETH  ${e.deployers} dev`);
      lines.push(c.dim(` tags ${k.top_tags.map((t) => `${t.tag} ${t.weight}`).join("  ")}`));
      lines.push("");
      lines.push(c.dim(`  token          symbol          phase  member  overlap  launched     last trade`));
      const members = k.members_out;
      for (const m of members) lines.push(`  ${short(m.token)}  ${fit(m.symbol ? "$" + m.symbol : c.dim("(no symbol)"), 15)} ${m.phase.padEnd(6)} ${m.membership.toFixed(2).padStart(6)}  ${String(m.buyers_overlap).padStart(7)}  ${fit(ago(m.launched_ts), 12)} ${c.dim(m.last_trade_ts ? ago(m.last_trade_ts) : "no trades")}`);
      lines.push("", c.dim(` b back · c contract · f flow`));
      for (let i = 0; i < bodyH; i++) L.push(fit(lines[i] ?? "", W));
    } else if (view === "board") {
      const rightW = W >= 120 ? Math.floor(W * 0.42) : 0, leftW = W - rightW - (rightW ? 1 : 0);
      const maxEth = Math.max(0.001, ...clusters.map((k) => k.heat.quote_norm_in));
      // columns adapt to the pane: wide panes show narrative, bar and flow; narrow ones keep status, meta, CA, ETH, buyers
      const wide = leftW >= 100, mid = leftW >= 78;
      const head = wide ? ` #  status        meta                  narrative        CA   ETH in         buyers  flow` : mid ? ` #  status        meta                  narrative      CA   ETH in  buyers` : ` #  status        meta                CA   ETH in`;
      const left: string[] = [];
      if (clusters.length) {
        const hottest = [...clusters].sort((x, y) => y.heat.quote_norm_in - x.heat.quote_norm_in)[0];
        const draining = [...clusters].sort((x, y) => y.flow.out_wallets - x.flow.out_wallets)[0];
        const totalEth = clusters.reduce((s, k) => s + k.heat.quote_norm_in, 0);
        const byNar = new Map<string, number>(); for (const k of clusters) byNar.set(k.narrative, (byNar.get(k.narrative) ?? 0) + k.heat.quote_norm_in);
        const nar = [...byNar].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round((v / (totalEth || 1)) * 100)}%`).join(" · ");
        left.push(fit(` ${c.dim("hottest")} ${c.bold(hottest.slug)} ${hottest.heat.quote_norm_in.toFixed(1)} ETH · ${hottest.heat.unique_buyers} buyers${draining.flow.out_wallets >= 8 ? `   ${c.dim("draining")} ${c.bold(draining.slug)} ${draining.flow.out_wallets} wallets left` : ""}`, leftW));
        left.push(fit(` ${c.dim("narratives")} ${c.cyan(nar)}   ${c.dim(`${clusters.length} metas · ${totalEth.toFixed(0)} ETH`)}`, leftW));
        left.push(fit("", leftW));
      }
      left.push(fit(c.dim(head), leftW));
      const listH = bodyH - left.length;
      if (sel < scroll) scroll = sel; if (sel >= scroll + listH) scroll = sel - listH + 1;
      for (let i = scroll; i < Math.min(clusters.length, scroll + listH); i++) {
        const k = clusters[i]; const h = k.heat;
        const nar = k.narrative + (k.narrative_sub ? "·" + k.narrative_sub : "");
        const parts = [`${i === sel ? "›" : " "}${String(k.rank).padStart(2)}`, STATUS_COLOR[k.status]?.(k.status.padEnd(12)) ?? k.status.padEnd(12), fit(k.slug, 20)];
        if (wide) parts.push(fit(c.cyan(nar), 15), String(h.n_launches).padStart(4), h.quote_norm_in.toFixed(2).padStart(7), bar(h.quote_norm_in, maxEth, 6), String(h.unique_buyers).padStart(6), c.dim(`⇦${k.flow.in_wallets} ⇨${k.flow.out_wallets}`));
        else if (mid) parts.push(fit(c.cyan(nar), 13), String(h.n_launches).padStart(4), h.quote_norm_in.toFixed(2).padStart(7), String(h.unique_buyers).padStart(6));
        else parts.push(String(h.n_launches).padStart(4), h.quote_norm_in.toFixed(2).padStart(7));
        const row = parts.join(" ");
        left.push(fit(i === sel ? `\x1b[7m${strip(row)}\x1b[0m` : row, leftW));
      }
      while (left.length < bodyH) left.push(fit("", leftW));
      if (!clusters.length) left[1] = fit(c.dim(a ? "  no live meta right now" : "  loading…"), leftW);
      const right: string[] = [];
      if (rightW && a && clusters[sel]) {
        const k = clusters[sel]; const h = k.heat;
        right.push(fit(`${c.bold(k.slug)}  ${STATUS_COLOR[k.status]?.(k.status) ?? k.status}  ${c.cyan(k.narrative)}${k.narrative_sub ? c.dim(" · " + k.narrative_sub) : ""}`, rightW));
        if (k.summary) right.push(fit(c.dim(k.summary), rightW));
        right.push(fit(c.dim(`${h.n_launches} CA · ${k.members.length} members · ${h.n_alive} alive · ${h.quote_norm_in.toFixed(2)} ETH · ${h.unique_buyers} buyers · ${h.n_graduated} grad · ${Math.round(h.graduated_share * 100)}% pool · Δ ${h.delta_pct ?? "n/a"}%`), rightW));
        right.push(fit(c.dim(`links name ${k.links.text} · semantic ${k.links.semantic} · wallet ${k.links.wallet} · deployer ${k.links.deployer}`), rightW));
        if (k.cohorts) right.push(fit(c.dim(`wallet clusters snipers ${k.cohorts.sniper} · rotators ${k.cohorts.rotator} · early-in-hot ${k.cohorts["early-in-hot"]} · sprayers ${k.cohorts.sprayer} of ${k.cohorts.total}`), rightW));
        const ein = a.edges.filter((e) => e.to === k.slug), eout = a.edges.filter((e) => e.from === k.slug);
        for (const e of ein.slice(0, 2)) right.push(fit(`  ⇦ ${e.from}  ${e.wallets} wallets  ${e.quote_norm.toFixed(2)} ETH`, rightW));
        for (const e of eout.slice(0, 2)) right.push(fit(`  ⇨ ${e.to}  ${e.wallets} wallets  ${e.quote_norm.toFixed(2)} ETH`, rightW));
        right.push(fit(c.dim(`tags ${k.top_tags.map((t) => t.tag).join(" ")}`), rightW));
        right.push(fit("", rightW));
        const members = k.members_out;
        for (const m of members.slice(0, bodyH - right.length - 1)) right.push(fit(`  ${short(m.token)} ${fit(m.symbol ? "$" + m.symbol : c.dim("(no symbol)"), 13)} ${m.phase.padEnd(5)} ${m.membership.toFixed(2)} ${String(m.buyers_overlap).padStart(3)} ovl ${c.dim(m.last_trade_ts ? ago(m.last_trade_ts) : "no trades")}`, rightW));
        while (right.length < bodyH) right.push(fit("", rightW));
      }
      for (let i = 0; i < bodyH; i++) L.push(rightW ? `${left[i]}${c.dim("│")}${right[i] ?? fit("", rightW)}` : left[i]);
    } else if (view === "coin") {
      const lines: string[] = [];
      if (coinBusy || !coin) lines.push(c.dim("  looking up…"));
      else if (coin.verdict === "NOT_PONS") lines.push(`  ${coin.token}`, `  ${VERDICT_COLOR.NOT_PONS("NOT_PONS")}  ${coin.reasons.join("; ")}`);
      else {
        const r = coin;
        lines.push(`  ${c.bold(r.symbol ? "$" + r.symbol : "(no symbol)")} · ${r.name || c.dim("(no name)")} · ${r.token}`);
        lines.push(c.dim(`  phase ${r.phase}${r.curve && r.phase === "curve" ? ` ${r.curve.real_quote_eth?.toFixed(2) ?? "?"}/${r.curve.threshold_eth} ${r.pair.symbol}` : ""} · launched ${ago(r.launched_at)} · pair ${r.pair.symbol}${r.narratives.length ? " · narrative " + r.narratives.join(", ") : ""}`));
        lines.push("");
        lines.push(`  ${VERDICT_COLOR[r.verdict]?.(r.verdict.padEnd(7)) ?? r.verdict} ${r.cluster ? `${c.bold(r.cluster.slug)}  ${r.cluster.membership.toFixed(2)}  (${STATUS_COLOR[r.cluster.status]?.(r.cluster.status) ?? r.cluster.status})` : c.dim("no cluster")}`);
        if (r.popularity?.cluster_rank) lines.push(`  ${c.cyan("popularity")} meta #${r.popularity.cluster_rank} of ${r.popularity.clusters_total} · ${r.popularity.rank_in_cluster ? `token #${r.popularity.rank_in_cluster} of ${r.popularity.cluster_size} inside` : `not among its ${r.popularity.cluster_size} members`} · ${r.popularity.buyers} buyers, more than ${r.popularity.buyers_percentile}% of tokens`);
        for (const alt of r.alternatives) lines.push(c.dim(`  alt ${alt.slug} ${alt.membership.toFixed(2)}`));
        lines.push("", "  reasons"); for (const s of r.reasons) lines.push(`    ${s}`);
        if (r.watch.length) { lines.push("  watch"); for (const s of r.watch) lines.push(`    ${c.yellow(s)}`); }
        lines.push("", c.dim(`  launch tx ${r.evidence.launch_tx}  block ${r.evidence.launch_block}  early buyers ${r.evidence.early_buyers}  overlap ${r.evidence.overlap_buyers}`));
        lines.push(c.dim("  IN means membership in a live meta. It is not a recommendation."));
      }
      for (let i = 0; i < bodyH; i++) L.push(fit(lines[i] ?? "", W));
    } else if (view === "flow") {
      const lines = [c.dim(`  from                    →  to                       wallets   ETH     deployers`)];
      for (const e of a?.edges ?? []) lines.push(`  ${fit(e.from, 22)}  →  ${fit(e.to, 22)}  ${String(e.wallets).padStart(6)}  ${e.quote_norm.toFixed(2).padStart(7)}  ${String(e.deployers).padStart(5)}`);
      if ((a?.edges.length ?? 0) === 0) lines.push(c.dim("  no edges above threshold in this window"));
      for (let i = 0; i < bodyH; i++) L.push(fit(lines[i] ?? "", W));
    } else if (view === "wallets") {
      const list = a ? a.wallets : [];
      const lines = [c.dim(`  wallet          buy/sell  tok   in ETH  out ETH     net  entry  wallet cluster         metas`)];
      for (const w of list.slice(0, bodyH - 1)) lines.push(`  ${short(w.wallet, 8)}  ${fit(`${w.buys}/${w.sells}`, 8)} ${String(w.tokens).padStart(4)} ${w.quote_in.toFixed(2).padStart(8)} ${w.quote_out.toFixed(2).padStart(8)} ${(w.net_eth >= 0 ? c.green : c.red)(w.net_eth.toFixed(2).padStart(7))} ${fit(w.median_entry_sec === null ? "-" : w.median_entry_sec + "s", 6)} ${fit(w.cohorts.join(","), 22)} ${c.dim(w.clusters.slice(0, 3).join(" "))}`);
      for (let i = 0; i < bodyH; i++) L.push(fit(lines[i] ?? "", W));
    }
    L.push(fit(c.dim(" " + "─".repeat(W - 2)), W));
    for (let i = 0; i < 7; i++) L.push(fit(events[i] ? " " + renderEvent(events[i]) : "", W));
    const help = input !== null ? `${c.bold(" CA ›")} ${input}${c.dim("▏")}  ${c.dim("enter to look up · esc to cancel")}` : c.dim(` ↑↓ move · enter open · c contract · f flow · W wallets · w window · r refresh · ? help · q quit`);
    L.push(fit(help, W));
    write("\x1b[H" + L.slice(0, H).join("\n") + "\x1b[J");
  };
  const painter = setInterval(() => { if (dirty || busy) draw(); }, busy ? 100 : 100);
  painter.unref();
  const resize = () => { dirty = true; }; out.on("resize", resize);

  // ---------------------------------------------------------------- keys
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true); process.stdin.resume();
  await new Promise<void>((done) => {
    process.stdin.on("keypress", (chr: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      dirty = true;
      if (process.env.NARRA_TUI_LOG) appendFileSync(process.env.NARRA_TUI_LOG, `${new Date().toISOString()} key=${JSON.stringify(key)} chr=${JSON.stringify(chr)} view=${view} input=${JSON.stringify(input)}\n`);
      if (key.ctrl && key.name === "c") { stop = true; done(); return; }
      if (input !== null) {
        if (key.name === "escape") { input = null; return; }
        if (key.name === "return" || key.name === "enter") { const ca = input.trim(); input = null; if (/^0x[0-9a-fA-F]{40}$/.test(ca)) void lookup(ca); else status = "not an address (0x + 40 hex)"; return; }
        if (key.name === "backspace") { input = input.slice(0, -1); return; }
        if (chr && !key.ctrl && chr.length === 1 && /[0-9a-zA-Zx]/.test(chr)) input += chr;
        else if (key.sequence && /^0x[0-9a-fA-F]{40}$/.test(key.sequence.trim())) input = key.sequence.trim(); // a paste arrives as one sequence
        return;
      }
      switch (key.name ?? chr) {
        case "q": stop = true; done(); break;
        case "up": case "k": sel = Math.max(0, sel - 1); break;
        case "down": case "j": sel = Math.min(Math.max(0, (a?.clusters.length ?? 1) - 1), sel + 1); break;
        case "return": case "enter": case "l": if (view === "board") view = "cluster"; break;
        case "b": case "escape": view = "board"; break;
        case "c": input = ""; break;
        case "f": view = view === "flow" ? "board" : "flow"; break;
        case "W": view = view === "wallets" ? "board" : "wallets"; break;
        case "?": case "h": view = view === "help" ? "board" : "help"; break;
        case "w": window = window === "15m" ? "60m" : window === "60m" ? "4h" : "15m"; state.first = true; wake?.(); break;
        case "r": wake?.(); break;
        default: if (chr === "W") view = view === "wallets" ? "board" : "wallets";
      }
    });
  });
  clearInterval(painter); live.stop(); stop = true; (wake as (() => void) | null)?.();
  try { child.disconnect(); } catch { /* already gone */ }
  await Promise.race([loop, new Promise((r) => setTimeout(r, 500))]);
  cleanup(); n.close();
  return 0;
}
