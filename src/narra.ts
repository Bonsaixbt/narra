/** The facade: one object that owns the store, the clients and the analysis, used by the CLI, the library and MCP. */
import { createClients, createGate, parseEndpoints, type Clients } from "./chain/rpc.js";
import { factoryAbi } from "./chain/abi.js";
import { ADDR, CHAIN, PROTOCOL } from "./chain/constants.js";
import { assertTopics } from "./chain/topics.js";
import { Store, resolveDbPath } from "./store/db.js";
import { BlockClock } from "./ingest/blocks.js";
import { sync, type SyncProgress } from "./ingest/sync.js";
import { WINDOWS, type WindowKey } from "./cli/args.js";
import { loadEnv } from "./env.js";

loadEnv();

export interface NarraOptions {
  rpc?: string;          // comma-separated, #nologs suffix supported
  ws?: string | "off";
  db?: string;
  retentionHours?: number;
}

export interface DoctorReport {
  ok: boolean;
  chain_id: number | null;
  head: number | null;
  rpc: { label: string; logs: boolean; benched: boolean }[];
  ws: string | null;
  factory: { launch_enabled: boolean | null; snipe_tax_start_bps: string | null; snipe_tax_seconds: string | null; meme_hook: string | null; pool_manager: string | null };
  expectations: { name: string; ok: boolean; detail: string }[];
  cache: { path: string; launches: number; tokens: number; trades: number; oldest_trade_ts: number | null; newest_trade_ts: number | null; cursor_block: number | null };
  semantic: { enabled: boolean; embed: string; name: string; embeddings: number; errors: string[] };
  errors: string[];
}

export class Narra {
  readonly store: Store;
  readonly clients: Clients;
  readonly clock: BlockClock;
  readonly retentionHours: number;

  constructor(opts: NarraOptions = {}) {
    assertTopics();
    const gate = createGate(parseEndpoints(opts.rpc ?? process.env.NARRA_RPC_URL));
    this.clients = createClients({ gate, ws: opts.ws ?? (process.env.NARRA_WS_URL as string | undefined) });
    this.store = new Store(resolveDbPath(opts.db ?? process.env.NARRA_DB));
    this.clock = new BlockClock(gate);
    this.retentionHours = opts.retentionHours ?? Number(process.env.NARRA_RETENTION_H ?? 48);
  }

  async sync(window: WindowKey | number = "60m", onProgress?: (p: SyncProgress) => void): Promise<SyncProgress> {
    const windowSec = typeof window === "number" ? window : WINDOWS[window];
    const p = await sync({ store: this.store, gate: this.clients.gate, http: this.clients.http, clock: this.clock }, { windowSec, onProgress });
    // A deep backfill raises the retention so it is not pruned away on the next tick.
    const kept = Math.max(this.retentionHours, Number(this.store.get("retention_h") ?? 0), Math.ceil(windowSec / 3600));
    if (kept > Number(this.store.get("retention_h") ?? 0)) this.store.set("retention_h", String(kept));
    this.store.prune(kept);
    return p;
  }

  async doctor(): Promise<DoctorReport> {
    const errors: string[] = [];
    const r: DoctorReport = {
      ok: true, chain_id: null, head: null, rpc: [], ws: this.clients.wsUrl,
      factory: { launch_enabled: null, snipe_tax_start_bps: null, snipe_tax_seconds: null, meme_hook: null, pool_manager: null },
      expectations: [],
      cache: { path: this.store.path, ...pick(this.store.stats(), ["launches", "tokens", "trades", "oldest_trade_ts", "newest_trade_ts"]), cursor_block: this.store.getCursor("main")?.last_block ?? null },
      semantic: { enabled: process.env.NARRA_SEMANTIC === "on", embed: process.env.NARRA_SEMANTIC_EMBED ?? "local", name: process.env.NARRA_SEMANTIC_NAME ?? "off", embeddings: this.store.embeddingCount(), errors: [] },
      errors,
    };
    try { r.chain_id = Number(BigInt((await this.clients.gate.request("eth_chainId")) as string)); } catch (e) { errors.push(`eth_chainId: ${(e as Error).message}`); }
    try { r.head = await this.clock.head(); } catch (e) { errors.push(`eth_blockNumber: ${(e as Error).message}`); }
    const f = { address: ADDR.ponsFactory, abi: factoryAbi } as const;
    const read = async <T,>(fn: "launchEnabled" | "snipeTaxStartBps" | "snipeTaxSeconds" | "memeHook" | "poolManager"): Promise<T | null> => {
      try { return (await this.clients.http.readContract({ ...f, functionName: fn })) as T; } catch (e) { errors.push(`${fn}: ${(e as Error).message.split("\n")[0]}`); return null; }
    };
    const [le, st, ss, hook, pm] = await Promise.all([read<boolean>("launchEnabled"), read<bigint>("snipeTaxStartBps"), read<bigint>("snipeTaxSeconds"), read<string>("memeHook"), read<string>("poolManager")]);
    r.factory = { launch_enabled: le, snipe_tax_start_bps: st?.toString() ?? null, snipe_tax_seconds: ss?.toString() ?? null, meme_hook: hook?.toLowerCase() ?? null, pool_manager: pm?.toLowerCase() ?? null };
    r.expectations = [
      { name: "chain id", ok: r.chain_id === CHAIN.id, detail: `${r.chain_id} vs ${CHAIN.id}` },
      { name: "snipe tax start", ok: st === PROTOCOL.snipeTaxStartBps, detail: `${st} bps` },
      { name: "snipe tax window", ok: ss === PROTOCOL.snipeTaxSeconds, detail: `${ss} s` },
      { name: "pool manager", ok: pm?.toLowerCase() === ADDR.v4PoolManager, detail: pm ?? "unreadable" },
      { name: "launches enabled", ok: le === true, detail: String(le) },
    ];
    r.rpc = this.clients.gate.stats().endpoints.map((e) => ({ label: e.label, logs: e.logs, benched: e.benched }));
    r.ok = errors.length === 0 && r.expectations.every((e) => e.ok);
    return r;
  }

  close(): void { this.store.close(); }
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = o[k];
  return out;
}

// ------------------------------------------------------------------------------------------------------
// Queries. Each one syncs the cache first (cold start prints progress through onProgress), then analyses.
// ------------------------------------------------------------------------------------------------------
import { analyze, membersOf, toTokenInfo, type Analysis } from "./analyze/board.js";
import { verdictFor } from "./analyze/verdict.js";
import { SCHEMA_VERSION, type NowOut, type CoinOut, type NotPonsOut, type FlowOut, type WhyOut, type WalletsOut, type WalletOut } from "./schemas.js";
import { curveAbi } from "./chain/abi.js";
import { enrichPending, ensurePairs } from "./ingest/enrich.js";
import type { Address } from "viem";
import type { RawLog } from "./ingest/decode.js";
import { decodeLaunch } from "./ingest/decode.js";
import { TOPICS } from "./chain/topics.js";
import { initSemantic, ensureEmbeddings, semanticPairs, nameCluster, categorize, type SemanticState } from "./semantic/index.js";
import { applyCategories } from "./semantic/taxonomy.js";
import { createHash } from "node:crypto";

export interface QueryOptions { window?: WindowKey; pair?: "all" | "eth" | "stable" | "stock"; members?: boolean; top?: number; onProgress?: (p: SyncProgress) => void; noSync?: boolean; noSemantic?: boolean }

declare module "./narra.js" {
  interface Narra {
    prepare(opts: QueryOptions): Promise<{ a: Analysis; meta: NowOut extends infer T ? Omit<T, "clusters" | "counts" | "quote_unit"> : never }>;
    now(opts?: QueryOptions): Promise<NowOut>;
    coin(address: string, opts?: QueryOptions): Promise<CoinOut | NotPonsOut>;
    flow(opts?: QueryOptions): Promise<FlowOut>;
    why(slug: string, opts?: QueryOptions): Promise<WhyOut | null>;
    wallets(opts?: QueryOptions & { cohort?: "sniper" | "sprayer" | "rotator" | "early-in-hot"; sort?: "net_eth" | "tokens" | "buys" | "quote_in" }): Promise<WalletsOut>;
    wallet(address: string, opts?: QueryOptions): Promise<WalletOut>;
  }
}

const semanticCache = new WeakMap<Narra, Promise<SemanticState>>();
export function semanticOf(n: Narra, off: boolean): Promise<SemanticState> {
  if (off) return initSemantic({ off: true });
  let p = semanticCache.get(n); if (!p) { p = initSemantic(); semanticCache.set(n, p); } return p;
}

Narra.prototype.prepare = async function (this: Narra, opts: QueryOptions) {
  const window: WindowKey = opts.window ?? "60m";
  const hadCursor = !!this.store.getCursor("main");
  let head: number | null = null;
  if (!opts.noSync) { const p = await this.sync(window, opts.onProgress); head = p.toBlock; }
  const cursor = this.store.getCursor("main")?.last_block ?? null;
  const nowTs = this.store.stats().newest_trade_ts ?? Math.floor(Date.now() / 1000);
  const sem = await semanticOf(this, !!opts.noSemantic || process.env.NARRA_SEMANTIC !== "on");
  let extras: Parameters<typeof analyze>[5] = {};
  if (sem.embedder) {
    // embed whatever the window will look at: launches + traded tokens are exactly what analyze() gathers
    const from = nowTs - WINDOWS[window];
    const traded = new Set<string>(); for (const t of this.store.tradesBetween(from, nowTs + 1)) if (t.token) traded.add(t.token);
    for (const l of this.store.launchesSince(from)) traded.add(l.token);
    const rows = this.store.launchesFor([...traded]); const pairs = this.store.pairs(); const meta = this.store.tokensFor(rows.map((l) => l.token));
    const infos = rows.map((l) => toTokenInfo(l, meta.get(l.token), pairs.get(l.pair)?.kind ?? "other", pairs.get(l.pair)?.symbol ?? "?"));
    await ensureEmbeddings(this.store, sem, infos);
    await categorize(this.store, sem, []); // embeds the anchors once
    extras = {
      categorize: (tokens) => { if (sem.anchors && sem.embedder) applyCategories(this.store, sem.embedder.model, sem.anchors, tokens); },
      semantic: (tokens) => semanticPairs(this.store, sem, tokens),
    };
  }
  const a = analyze(this.store, window, WINDOWS[window], nowTs, undefined, extras);
  if (sem.namer) {
    for (const c of a.clusters.slice(0, 30)) {
      const top = c.members.slice(0, 12).sort();
      const key = createHash("sha1").update(top.join(",")).digest("hex").slice(0, 16);
      const r = await nameCluster(this.store, sem, { slug: c.slug, tags: c.top_tags.map((t) => t.tag), members: c.members.slice(0, 12).map((m) => { const t = a.tokens.get(m)!; return { symbol: t.symbol, name: t.name, description: t.description }; }), heat: c.heat }, key);
      if (r) { c.label = r.label; c.summary = r.summary; c.label_source = r.source; }
    }
  }
  const meta = {
    schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, computed_at: new Date().toISOString(), window,
    window_from: a.window.from, window_to: a.window.to, head_block: head ?? cursor, lag_blocks: head !== null && cursor !== null ? head - cursor : null,
    source: { rpc: this.clients.gate.labels(), mode: (opts.noSync ? "cache" : hadCursor ? "cache" : "cold") as "cold" | "cache" | "live" },
  };
  return { a, meta };
};

Narra.prototype.now = async function (this: Narra, opts: QueryOptions = {}): Promise<NowOut> {
  const { a, meta } = await this.prepare(opts);
  const pair = opts.pair ?? "all";
  let clusters = a.clusters.filter((c) => pair === "all" || (c.heat.pair_mix[pair] ?? 0) > 0);
  if (opts.top) clusters = clusters.slice(0, opts.top);
  return {
    ...meta, quote_unit: "ETH",
    clusters: clusters.map((c) => ({ slug: c.slug, label: c.label, status: c.status, top_tags: c.top_tags, n_members: c.members.length, heat: c.heat, links: c.links, summary: c.summary, label_source: c.label_source, cohorts: c.cohorts, rotating_from: c.rotating_from, rotating_to: c.rotating_to, ...(opts.members ? { members: membersOf(a, c, this.store) } : {}) })),
    counts: a.counts,
  };
};

Narra.prototype.coin = async function (this: Narra, address: string, opts: QueryOptions = {}): Promise<CoinOut | NotPonsOut> {
  const token = address.toLowerCase();
  const { a, meta } = await this.prepare(opts);
  let launch = this.store.launch(token);
  if (!launch) {
    // Not in the window: ask the factory, then find its launch log by token topic.
    const rec = await this.clients.http.readContract({ address: ADDR.ponsFactory, abi: factoryAbi, functionName: "getLaunchedToken", args: [token as Address] }).catch(() => null);
    if (!rec || !rec.exists) return { ...meta, token, verdict: "NOT_PONS", reasons: ["this address is not a Pons v2 launch on Robinhood Chain (factory has no record of it)"] };
    const head = await this.clock.head();
    const topic = ("0x" + token.slice(2).padStart(64, "0")) as `0x${string}`;
    for (const span of [500_000, 2_000_000, 8_000_000]) {
      const logs = (await this.clients.gate.request("eth_getLogs", [{ address: ADDR.ponsFactory, topics: [TOPICS.tokenLaunched, topic], fromBlock: "0x" + Math.max(0, head - span).toString(16), toBlock: "0x" + head.toString(16) }])) as RawLog[];
      if (logs.length) { const blk = Number(BigInt(logs[0].blockNumber)); const L = decodeLaunch(logs[0], await this.clock.timestamp(blk)); if (L) { L.phase = Number(rec.phase); this.store.upsertLaunches([L]); await ensurePairs(this.store, this.clients.http, [L.pair]); break; } }
    }
    launch = this.store.launch(token);
    if (!launch) return { ...meta, token, verdict: "NOT_PONS", reasons: ["the factory knows this token but its launch log was not found in the last 8M blocks"] };
    await enrichPending(this.store, this.clients.http, 5);
  }
  const trow = this.store.tokensFor([token]).get(token);
  const pairRow = this.store.pair(launch.pair);
  const info = a.tokens.get(token) ?? toTokenInfo(launch, trow, pairRow?.kind ?? "other", pairRow?.symbol ?? "?");
  const trades = this.store.tradesForToken(token, 500);
  const v = verdictFor(info, trades, { wallets: a.wallets, recentBuyers: a.recentBuyers, clusters: a.clusters, centroids: a.centroids, membership: a.membership, buyers: a.buyers, tokens: a.tokens, window: a.window });
  // live curve state for the card
  let curve: CoinOut["curve"] = null;
  const thresholdEth = Number(BigInt(launch.graduation_threshold)) / 10 ** (pairRow?.decimals ?? 18);
  if (info.phase === "curve") {
    const real = await this.clients.http.readContract({ address: launch.curve as Address, abi: curveAbi, functionName: "realQuoteReserve" }).catch(() => null);
    const realQ = real === null ? null : Number(real) / 10 ** (pairRow?.decimals ?? 18);
    curve = { real_quote_eth: realQ, threshold_eth: thresholdEth, progress: realQ === null ? null : Math.min(1, realQ / thresholdEth) };
  } else curve = { real_quote_eth: null, threshold_eth: thresholdEth, progress: 1 };
  const swaps = this.store.swapsSince(a.window.from).filter((s) => s.token === token);
  const pool = info.phase === "pool" && launch.graduated_at ? { graduated_at: launch.graduated_at, volume_eth_window: swaps.reduce((s, x) => s + (x.quote_norm ?? 0), 0), swaps_window: swaps.length } : null;
  return {
    ...meta, token, symbol: info.symbol, name: info.name, phase: info.phase, curve, pool,
    pair: { address: launch.pair, symbol: pairRow?.symbol ?? "?", kind: pairRow?.kind ?? "other" },
    launched_at: launch.ts, deployer: launch.deployer,
    ...v, evidence: { ...v.evidence, launch_tx: launch.tx_hash, launch_block: launch.block },
  };
};

Narra.prototype.flow = async function (this: Narra, opts: QueryOptions = {}): Promise<FlowOut> {
  const { a, meta } = await this.prepare(opts);
  return { ...meta, nodes: a.clusters.map((c) => ({ slug: c.slug, status: c.status })), edges: a.edges };
};

Narra.prototype.why = async function (this: Narra, slug: string, opts: QueryOptions = {}): Promise<WhyOut | null> {
  const { a, meta } = await this.prepare(opts);
  const c = a.clusters.find((x) => x.slug === slug);
  if (!c) return null;
  const tags = c.top_tags.map((t) => ({ ...t, examples: c.members.filter((m) => a.tokens.get(m)?.tags.has(t.tag)).slice(0, 5).map((m) => a.tokens.get(m)?.symbol || m.slice(0, 10)) }));
  return {
    ...meta,
    cluster: { slug: c.slug, label: c.label, status: c.status, top_tags: c.top_tags, n_members: c.members.length, heat: c.heat, links: c.links, summary: c.summary, label_source: c.label_source, cohorts: c.cohorts, rotating_from: c.rotating_from, rotating_to: c.rotating_to, members: membersOf(a, c, this.store) },
    tags, edges_in: a.edges.filter((e) => e.to === c.slug), edges_out: a.edges.filter((e) => e.from === c.slug),
    rule: "two tokens are linked when weighted Jaccard of their tags ≥ 0.35, or they share ≥ 5 buyers, or they share a deployer and a tag; the cluster is the connected component; the slug is its two heaviest tags",
  };
};

Narra.prototype.wallets = async function (this: Narra, opts: QueryOptions & { cohort?: "sniper" | "sprayer" | "rotator" | "early-in-hot"; sort?: "net_eth" | "tokens" | "buys" | "quote_in" } = {}): Promise<WalletsOut> {
  const { a, meta } = await this.prepare(opts);
  const sort = opts.sort ?? "net_eth";
  let list = [...a.wallets.values()];
  const counts = { wallets: list.length, sniper: 0, sprayer: 0, rotator: 0, "early-in-hot": 0 };
  for (const w of list) for (const c of w.cohorts) counts[c]++;
  if (opts.cohort) list = list.filter((w) => w.cohorts.includes(opts.cohort!));
  list.sort((x, y) => (y[sort] as number) - (x[sort] as number));
  return { ...meta, cohort: opts.cohort ?? null, sort, wallets: list.slice(0, opts.top ?? 25), counts };
};

Narra.prototype.wallet = async function (this: Narra, address: string, opts: QueryOptions = {}): Promise<WalletOut> {
  const w = address.toLowerCase();
  const { a, meta } = await this.prepare(opts);
  const trades = this.store.tradesForWallet(w, a.window.from - a.window.sec * 3);
  const swaps = this.store.swapsForWallet(w, a.window.from - a.window.sec * 3);
  const tokens = [...new Set([...trades.map((t) => t.token).filter((t): t is string => !!t), ...swaps.map((s) => s.token)])];
  const launches = new Map(this.store.launchesFor(tokens).map((l) => [l.token, l]));
  const meta2 = this.store.tokensFor(tokens);
  const statuses = new Map(a.clusters.map((c) => [c.slug, c.status]));
  const pos = new Map<string, WalletOut["positions"][number]>();
  const get = (token: string) => { let p = pos.get(token); if (!p) { const slug = a.membership.get(token) ?? null; p = { token, symbol: meta2.get(token)?.symbol ?? "", cluster: slug, status: slug ? statuses.get(slug) ?? null : null, venue: "curve", buys: 0, sells: 0, quote_in: 0, quote_out: 0, first_buy_after_launch_sec: null, last_ts: 0 }; pos.set(token, p); } return p; };
  for (const t of trades) { if (!t.token) continue; const p = get(t.token); if (t.side === "buy") { p.buys++; p.quote_in += t.quote_norm ?? 0; const l = launches.get(t.token); if (l && (p.first_buy_after_launch_sec === null || t.ts - l.ts < p.first_buy_after_launch_sec)) p.first_buy_after_launch_sec = t.ts - l.ts; } else { p.sells++; p.quote_out += t.quote_norm ?? 0; } p.last_ts = Math.max(p.last_ts, t.ts); }
  for (const s of swaps) { const p = get(s.token); p.venue = p.buys + p.sells ? "both" : "pool"; if (s.side === "buy") { p.buys++; p.quote_in += s.quote_norm ?? 0; } else { p.sells++; p.quote_out += s.quote_norm ?? 0; } p.last_ts = Math.max(p.last_ts, s.ts); }
  const positions = [...pos.values()].map((p) => ({ ...p, quote_in: Math.round(p.quote_in * 1000) / 1000, quote_out: Math.round(p.quote_out * 1000) / 1000 })).sort((x, y) => y.last_ts - x.last_ts);
  return { ...meta, wallet: w, stat: a.wallets.get(w) ?? null, positions, note: "public on-chain activity over the cache; net flow ignores what the wallet still holds and is not a P&L claim" };
};
