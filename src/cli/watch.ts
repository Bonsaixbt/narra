/**
 * Live feed. v0.1 polls: sync every `--every` seconds, re-analyse, and print what changed.
 * Event types: LAUNCH (new token, with its cluster if any), STATUS (cluster status changed), EDGE (new flow edge),
 * GRAD (token graduated), JOIN (token entered a published cluster), SYNC (heartbeat with counts).
 */
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, utc, STATUS_COLOR, short } from "./render.js";
import { SCHEMA_VERSION, type WatchEvent } from "../schemas.js";
import type { Narra } from "../narra.js";
import type { Analysis } from "../analyze/board.js";
import { liveTrigger } from "../ingest/live.js";

export interface WatchState { statuses: Map<string, string>; edges: Set<string>; members: Map<string, string>; phases: Map<string, string>; seenLaunch: Set<string>; first: boolean }

export function diffEvents(prev: WatchState, a: Analysis, ts: string): WatchEvent[] {
  const ev: WatchEvent[] = [];
  const base = { schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, ts };
  for (const k of a.clusters) {
    const old = prev.statuses.get(k.slug);
    if (!prev.first && old !== k.status) ev.push({ ...base, type: "STATUS", slug: k.slug, from: old ?? "NEW", to: k.status, note: `${k.heat.n_launches} CA · ${k.heat.quote_norm_in.toFixed(2)} ETH · ${k.heat.unique_buyers} buyers` });
    prev.statuses.set(k.slug, k.status);
  }
  for (const e of a.edges) {
    const key = `${e.from}→${e.to}`;
    if (!prev.first && !prev.edges.has(key)) ev.push({ ...base, type: "EDGE", from: e.from, to: e.to, wallets: e.wallets, note: `${e.quote_norm.toFixed(2)} ETH · ${e.deployers} deployers` });
    prev.edges.add(key);
  }
  for (const l of a.launches) {
    const t = a.tokens.get(l.token);
    const slug = a.membership.get(l.token);
    if (!prev.first && !prev.seenLaunch.has(l.token)) ev.push({ ...base, type: "LAUNCH", token: l.token, symbol: t?.symbol ?? "", slug, note: t?.name ?? "" });
    prev.seenLaunch.add(l.token);
    const phase = t?.phase ?? "curve";
    const oldPhase = prev.phases.get(l.token);
    if (!prev.first && oldPhase && oldPhase !== "pool" && phase === "pool") ev.push({ ...base, type: "GRAD", token: l.token, symbol: t?.symbol ?? "", slug });
    prev.phases.set(l.token, phase);
    if (slug) {
      const oldSlug = prev.members.get(l.token);
      if (!prev.first && oldSlug !== slug && prev.seenLaunch.has(l.token) && oldSlug !== undefined) ev.push({ ...base, type: "JOIN", token: l.token, symbol: t?.symbol ?? "", slug, from: oldSlug });
      else if (!prev.first && oldSlug === undefined && prev.phases.has(l.token) && !ev.some((x) => x.type === "LAUNCH" && x.token === l.token)) ev.push({ ...base, type: "JOIN", token: l.token, symbol: t?.symbol ?? "", slug });
      prev.members.set(l.token, slug);
    }
  }
  prev.first = false;
  return ev;
}

export function renderEvent(e: WatchEvent): string {
  const t = c.dim(e.ts.slice(11, 19));
  switch (e.type) {
    case "STATUS": return `${t} ${c.bold("STATUS")}  ${e.slug}  ${e.from} → ${STATUS_COLOR[e.to ?? ""]?.(e.to ?? "") ?? e.to}  ${c.dim(e.note ?? "")}`;
    case "EDGE": return `${t} ${c.bold("EDGE  ")}  ${e.from} → ${e.to}  ${e.wallets} wallets  ${c.dim(e.note ?? "")}`;
    case "LAUNCH": return `${t} ${c.dim("LAUNCH")}  ${short(e.token ?? "")}  ${e.symbol ? "$" + e.symbol : c.dim("(pending)")}  ${e.slug ? c.green("in " + e.slug) : c.dim("unclustered")}  ${c.dim(e.note ?? "")}`;
    case "GRAD": return `${t} ${c.bold("GRAD  ")}  ${short(e.token ?? "")}  $${e.symbol}  ${e.slug ? "in " + e.slug : ""}`;
    case "JOIN": return `${t} ${c.cyan("JOIN  ")}  ${short(e.token ?? "")}  $${e.symbol}  → ${e.slug}${e.from ? c.dim(" (was " + e.from + ")") : ""}`;
    case "SYNC": return `${t} ${c.dim("SYNC    " + (e.note ?? ""))}`;
  }
}

export async function watchLoop(n: Narra, opts: { window: "15m" | "60m" | "4h"; everySec: number; only?: Set<string>; onEvent: (e: WatchEvent) => void; onProgress?: Parameters<Narra["sync"]>[1]; signal?: AbortSignal; live?: boolean }): Promise<void> {
  const state: WatchState = { statuses: new Map(), edges: new Set(), members: new Map(), phases: new Map(), seenLaunch: new Set(), first: true };
  let progress = opts.onProgress;
  // The socket wakes the loop early; the polling interval stays as the floor.
  let wakeNow: ((reason: string) => void) | null = null;
  let wakeReason = "timer";
  const live = opts.live === false ? null : liveTrigger(n.clients.ws, (reason) => { wakeReason = reason; wakeNow?.(reason); });
  try {
    while (!opts.signal?.aborted) {
      const t0 = Date.now();
      try {
        const { a, meta } = await n.prepare({ window: opts.window, onProgress: progress });
        progress = undefined;
        const ts = new Date().toISOString();
        const events = diffEvents(state, a, ts);
        const emit = (e: WatchEvent) => { if (!opts.only || opts.only.has(e.type)) opts.onEvent(e); };
        for (const e of events) emit(e);
        const lh = live?.health();
        emit({ schema_version: SCHEMA_VERSION, ts, type: "SYNC", note: `head ${meta.head_block} · ${a.clusters.length} clusters · ${a.counts.launches} launches · ${a.counts.trades} trades in ${opts.window} · woke by ${wakeReason}${lh ? ` · ${lh.mode}${lh.note ? " (" + lh.note + ")" : ""}` : ""}` });
        wakeReason = "timer";
      } catch (err) {
        opts.onEvent({ schema_version: SCHEMA_VERSION, ts: new Date().toISOString(), type: "SYNC", note: `error: ${(err as Error).message.split("\n")[0]}` });
      }
      const wait = Math.max(1_000, opts.everySec * 1000 - (Date.now() - t0));
      await new Promise<void>((r) => {
        const id = setTimeout(() => { wakeNow = null; r(); }, wait);
        wakeNow = () => { clearTimeout(id); wakeNow = null; r(); };
        opts.signal?.addEventListener("abort", () => { clearTimeout(id); r(); }, { once: true });
      });
    }
  } finally { live?.stop(); }
}

export async function watch(args: Args): Promise<number> {
  const { n, q } = open(args);
  const only = str(args.flags.only) ? new Set(str(args.flags.only)!.split(",").map((s) => s.trim().toUpperCase())) : undefined;
  const everySec = Number(str(args.flags.every) ?? 15);
  const ac = new AbortController();
  process.on("SIGINT", () => { ac.abort(); });
  try {
    if (!args.flags.jsonl) console.error(c.dim(`narra watch · window ${q.window} · every ${everySec}s · ctrl-c to stop`));
    await watchLoop(n, { window: q.window!, everySec, only, onProgress: q.onProgress, signal: ac.signal, onEvent: (e) => { if (args.flags.jsonl || args.flags.json) printJson(e); else if (e.type !== "SYNC" || !only) console.log(renderEvent(e)); } });
    return 0;
  } finally { n.close(); }
}
