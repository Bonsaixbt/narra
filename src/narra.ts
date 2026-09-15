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
    this.retentionHours = opts.retentionHours ?? Number(process.env.NARRA_RETENTION_H ?? 24);
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
import { analyze, membersOf, lastTradeByToken, toTokenInfo, type Analysis } from "./analyze/board.js";
import { isLive } from "./analyze/status.js";
import { verdictFor } from "./analyze/verdict.js";
import { SCHEMA_VERSION, type NowOut, type CoinOut, type NotPonsOut, type FlowOut, type WhyOut, type WalletsOut, type WalletOut, type WalletClustersOut } from "./schemas.js";
import { curveAbi } from "./chain/abi.js";
import { enrichPending, ensurePairs } from "./ingest/enrich.js";
import type { Address } from "viem";
import type { RawLog } from "./ingest/decode.js";
import { decodeLaunch } from "./ingest/decode.js";
import { TOPICS } from "./chain/topics.js";
import { initSemantic, ensureEmbeddings, semanticPairs, nameCluster, categorize, type SemanticState } from "./semantic/index.js";
import { applyCategories } from "./semantic/taxonomy.js";
import { tokenNarratives } from "./analyze/narrative.js";
import { readBoard, readWhy, readFlow, readWallets, readTrend, readClusterHistory, readTokenHistory, readFlowHistory } from "./analyze/readings.js";
import { flowHistory, type FlowStep, type FlowHistoryOut } from "./analyze/flowHistory.js";

export interface QueryOptions {
  /** A ready analysis to answer from (the service keeps one per window); skips sync and analyze. */
  analysis?: { a: Analysis; meta: NowOut extends infer T ? Omit<T, "clusters" | "counts" | "quote_unit"> : never };
  window?: WindowKey; pair?: "all" | "eth" | "stable" | "stock"; members?: boolean; top?: number; all?: boolean; onProgress?: (p: SyncProgress) => void; noSync?: boolean; noSemantic?: boolean }

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
  if (opts.analysis) return opts.analysis;
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
    // one name per meta id (stable across ticks); the model is asked only for live metas with enough members to
    // describe, everything else is served from the cache — with member-set keys the 40-call budget was gone in two ticks
    // at most a few model calls per pass (each is seconds of waiting inside the tick); names accumulate over ticks
    let calls = 0;
    for (const c of a.clusters.slice(0, 60)) {
      // a meta earns a model call once it has lived five minutes with five members: the budget went to metas that died within a tick
      const allowModel = calls < 3 && isLive(c.status) && c.members.length >= 5 && c.rank <= 25 && c.first_seen_ts <= a.window.to - 300;
      const r = await nameCluster(this.store, sem, { slug: c.slug, tags: c.top_tags.map((t) => t.tag), members: c.members.slice(0, 12).map((m) => { const t = a.tokens.get(m)!; return { symbol: t.symbol, name: t.name, description: t.description }; }), heat: c.heat }, `id:${c.id}`, { allowModel });
      if (r) { c.label = r.label; c.summary = r.summary; c.label_source = r.source; if (r.source === "model") calls++; }
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
  // the members path used to rescan every trade in the window once per cluster (77 clusters × 300k trades): one pass now
  const lastTrades = opts.members ? lastTradeByToken(a) : undefined;
  const out: NowOut = {
    ...meta, quote_unit: "ETH",
    clusters: clusters.map((c) => ({ slug: c.slug, id: c.id, first_seen_ts: c.first_seen_ts, label: c.label, status: c.status, top_tags: c.top_tags, n_members: c.members.length, heat: c.heat, links: c.links, summary: c.summary, label_source: c.label_source, narrative: c.narrative, narrative_sub: c.narrative_sub, narrative_mix: c.narrative_mix, flow: c.flow, rank: c.rank, cohorts: c.cohorts, rotating_from: c.rotating_from, rotating_to: c.rotating_to, ...(opts.members ? { members: membersOf(a, c, this.store, lastTrades) } : {}) })),
    counts: a.counts,
  };
  out.reading = readBoard({ clusters: a.clusters.map((c) => ({ ...c, n_members: c.members.length, members: undefined })) as NowOut["clusters"], counts: a.counts, window: out.window });
  return out;
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
  const v = verdictFor(info, trades, { wallets: a.wallets, recentBuyers: a.recentBuyers, deployerFan: a.deployerFan, clusters: a.clusters, centroids: a.centroids, membership: a.membership, buyers: a.buyers, tokens: a.tokens, window: a.window });
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
  // popularity: where the cluster sits on the board and where the token sits inside it, by buyers in the window
  const myBuyers = a.buyers.get(token)?.size ?? 0;
  const allBuyerCounts = [...a.tokens.keys()].map((t) => a.buyers.get(t)?.size ?? 0);
  const below = allBuyerCounts.filter((x) => x < myBuyers).length;
  const cl = v.cluster ? a.clusters.find((c) => c.slug === v.cluster!.slug) : undefined;
  const inCluster = cl ? [...cl.members].sort((x, y) => (a.buyers.get(y)?.size ?? 0) - (a.buyers.get(x)?.size ?? 0)) : [];
  const popularity = { cluster_rank: cl?.rank ?? null, clusters_total: a.clusters.length, rank_in_cluster: cl ? (inCluster.indexOf(token) >= 0 ? inCluster.indexOf(token) + 1 : null) : null, cluster_size: cl?.members.length ?? null, buyers: myBuyers, buyers_percentile: allBuyerCounts.length ? Math.min(99, Math.round((below / allBuyerCounts.length) * 100)) : 0 };
  // activity and context that make a card readable even when no meta is near
  const nowTs = a.window.to;
  const buys60 = trades.filter((t) => t.side === "buy" && t.ts >= nowTs - 3600), sells60 = trades.filter((t) => t.side === "sell" && t.ts >= nowTs - 3600);
  const buys10 = buys60.filter((t) => t.ts >= nowTs - 600);
  const poolBuys = swaps.filter((x) => x.side === "buy");
  const activity = {
    buys_10m: buys10.length + poolBuys.filter((x) => x.ts >= nowTs - 600).length, buyers_10m: new Set([...buys10.map((t) => t.recipient), ...poolBuys.filter((x) => x.ts >= nowTs - 600).map((x) => x.wallet)]).size,
    buys_60m: buys60.length + poolBuys.length, buyers_60m: new Set([...buys60.map((t) => t.recipient), ...poolBuys.map((x) => x.wallet)]).size, sells_60m: sells60.length + swaps.filter((x) => x.side === "sell").length,
    eth_in_60m: Math.round((buys60.reduce((z, t) => z + (t.quote_norm ?? 0), 0) + poolBuys.reduce((z, x) => z + (x.quote_norm ?? 0), 0)) * 1000) / 1000,
    last_trade_ts: trades.length || swaps.length ? Math.max(trades.at(-1)?.ts ?? 0, swaps.at(-1)?.ts ?? 0) : null, first_trade_ts: trades[0]?.ts ?? null,
  };
  const earlySet = new Set<string>(); for (const t of trades) if (t.side === "buy" && earlySet.size < 100) earlySet.add(t.recipient);
  const early_cohorts = { sniper: 0, sprayer: 0, rotator: 0, "early-in-hot": 0, total: earlySet.size };
  for (const w of earlySet) { const st = a.wallets.get(w); if (!st) continue; for (const k of st.cohorts) early_cohorts[k]++; }
  const deployerFan = a.deployerFan.get(launch.deployer) ?? 0;
  const words = [...info.tags.keys()].filter((t) => !t.startsWith("pair:") && !t.startsWith("cat:")).slice(0, 8);
  const reading = buildReading({ verdict: v.verdict, cluster: v.cluster, clusters_total: a.clusters.length, nearest: v.nearest, popularity, activity, early_cohorts, deployerFan, phase: info.phase, curve, pairSymbol: pairRow?.symbol ?? "?", launchedAt: launch.ts, nowTs, narratives: tokenNarratives(info) });
  if (cl) v.reasons.push(`popularity: meta #${cl.rank} of ${a.clusters.length} on the board (${cl.narrative}${cl.narrative_sub ? " · " + cl.narrative_sub : ""}); ${popularity.rank_in_cluster ? `token #${popularity.rank_in_cluster} of ${cl.members.length} inside it by buyers` : `joins it by wallets, not a member by name`}; ${popularity.buyers > 0 ? `more buyers than ${popularity.buyers_percentile}% of tokens in the window` : "no buyers inside this window"}`);
  return {
    ...meta, token, symbol: info.symbol, name: info.name, phase: info.phase, curve, pool,
    pair: { address: launch.pair, symbol: pairRow?.symbol ?? "?", kind: pairRow?.kind ?? "other" },
    launched_at: launch.ts, deployer: launch.deployer,
    ...v, reading, activity, early_cohorts, deployer_launches_window: deployerFan, words, narratives: tokenNarratives(info), popularity, evidence: { ...v.evidence, launch_tx: launch.tx_hash, launch_block: launch.block },
  };
};

/** The sentence a person reads first. Every clause is a number that is also in the JSON. */
export function buildReading(x: { verdict: string; cluster: { slug: string; status: string; membership: number } | null; clusters_total: number; nearest: { slug: string; status: string; membership: number; overlap: number }[]; popularity: { cluster_rank: number | null; rank_in_cluster: number | null; cluster_size: number | null; buyers_percentile: number; buyers: number }; activity: { buys_10m: number; buyers_10m: number; buys_60m: number; buyers_60m: number; sells_60m: number; eth_in_60m: number; last_trade_ts: number | null }; early_cohorts: { sniper: number; rotator: number; "early-in-hot": number; sprayer: number; total: number }; deployerFan: number; phase: string; curve: { progress: number | null } | null; pairSymbol: string; launchedAt: number; nowTs: number; narratives: string[] }): string {
  const ageMin = Math.max(0, Math.round((Math.floor(Date.now() / 1000) - x.launchedAt) / 60));
  const age = ageMin < 90 ? `${ageMin}m old` : ageMin < 48 * 60 ? `${(ageMin / 60).toFixed(1)}h old` : `${Math.round(ageMin / 1440)}d old`;
  const parts: string[] = [];
  if (x.verdict === "IN" && x.cluster) parts.push(`In a live meta (${x.cluster.slug}, ${x.cluster.status.toLowerCase()}, #${x.popularity.cluster_rank} of ${x.clusters_total})${x.popularity.rank_in_cluster ? `, token #${x.popularity.rank_in_cluster} of ${x.popularity.cluster_size} inside by buyers` : ""}.`);
  else if (x.verdict === "EDGE" && x.cluster) parts.push(`On the edge of ${x.cluster.slug} (${x.cluster.status.toLowerCase()}): the name fits, the crowd mostly does not.`);
  else if (x.verdict === "OUT" && x.cluster) parts.push(`Belongs to ${x.cluster.slug}, but that meta is ${x.cluster.status.toLowerCase()} or its buyers are leaving.`);
  else parts.push(`Standalone: no live meta shares its words or its buyers${x.nearest[0] && x.nearest[0].membership >= 0.1 ? `; closest is ${x.nearest[0].slug} at ${x.nearest[0].membership.toFixed(2)}` : ""}.`);
  const act = x.activity;
  if (act.buyers_60m === 0) parts.push(`No buys in the last hour${act.last_trade_ts ? `, last trade ${Math.round((x.nowTs - act.last_trade_ts) / 60)}m ago` : ""}.`);
  else parts.push(`${act.buyers_60m} buyers and ${act.eth_in_60m.toFixed(2)} ETH in the last hour${act.buys_10m ? `, ${act.buys_10m} buys in the last 10 minutes` : ", nothing in the last 10 minutes"}${act.sells_60m > act.buys_60m ? ", more sells than buys" : ""}${x.popularity.buyers > 0 ? `; more buyers than ${x.popularity.buyers_percentile}% of tokens in the window` : ""}.`);
  const ec = x.early_cohorts;
  if (ec.total >= 5) {
    const bits: string[] = [];
    if (ec.sniper / ec.total >= 0.3) bits.push(`${Math.round((ec.sniper / ec.total) * 100)}% snipers`);
    if (ec["early-in-hot"] >= 3) bits.push(`${ec["early-in-hot"]} early-in-hot wallets`);
    if (ec.rotator >= 3) bits.push(`${ec.rotator} rotators`);
    if (ec.sprayer / ec.total >= 0.3) bits.push(`${Math.round((ec.sprayer / ec.total) * 100)}% sprayer bots`);
    if (bits.length) parts.push(`Early buyers: ${bits.join(", ")}.`);
  }
  if (x.deployerFan >= 5) parts.push(`Deployer is a launch farm: ${x.deployerFan} tokens in this window.`);
  const stage = x.phase === "pool" ? "graduated, trading in the pool" : x.phase === "swept" ? "swept, pool not open yet" : x.curve?.progress !== null && x.curve?.progress !== undefined ? `${Math.round(x.curve.progress * 100)}% of the way to graduation on the ${x.pairSymbol} curve` : "on the curve";
  parts.push(`${age}, ${stage}${x.narratives.length ? `; words say ${x.narratives.join(", ")}` : ""}.`);
  return parts.join(" ");
}

Narra.prototype.flow = async function (this: Narra, opts: QueryOptions = {}): Promise<FlowOut> {
  const { a, meta } = await this.prepare(opts);
  // moves carry the buy that put each wallet on the edge; the symbol is looked up here, where the tokens are
  const edges = a.edges.map((e) => ({ ...e, moves: (e.moves ?? []).map((m) => ({ ...m, symbol: a.tokens.get(m.token)?.symbol ?? "" })) }));
  const out: FlowOut = { ...meta, nodes: a.clusters.map((c) => ({ slug: c.slug, status: c.status, id: c.id, first_seen_ts: c.first_seen_ts })), edges };
  out.reading = readFlow(out);
  return out;
};

/** Exact slug, else the single cluster whose slug, label, tags or member tickers contain the text; several matches → an error listing them. */
export function resolveCluster(a: Analysis, text: string): { cluster: ClusterOutLike | null; candidates: string[] } {
  const q = text.toLowerCase();
  const exact = a.clusters.find((x) => x.slug === q);
  if (exact) return { cluster: exact, candidates: [] };
  const hits = a.clusters.filter((x) => x.slug.includes(q) || x.label.toLowerCase().includes(q) || x.top_tags.some((t) => t.tag.includes(q)) || x.members.some((m) => { const t = a.tokens.get(m); return !!t && (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)); }));
  if (hits.length === 1) return { cluster: hits[0], candidates: [] };
  return { cluster: null, candidates: hits.map((h) => h.slug) };
}
type ClusterOutLike = Analysis["clusters"][number];

Narra.prototype.why = async function (this: Narra, slug: string, opts: QueryOptions = {}): Promise<WhyOut | null> {
  const { a, meta } = await this.prepare(opts);
  const res = resolveCluster(a, slug);
  if (!res.cluster) { if (res.candidates.length) throw new Error(`"${slug}" matches ${res.candidates.length} metas: ${res.candidates.slice(0, 8).join(", ")}${res.candidates.length > 8 ? ", …" : ""}`); return null; }
  const c = res.cluster;
  const tags = c.top_tags.map((t) => {
    const counts = new Map<string, number>();
    for (const m of c.members) if (a.tokens.get(m)?.tags.has(t.tag)) { const sym = a.tokens.get(m)?.symbol || m.slice(0, 10); counts.set(sym, (counts.get(sym) ?? 0) + 1); }
    return { ...t, examples: [...counts].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([sym, n]) => (n > 1 ? `${sym} ×${n}` : sym)) };
  });
  const out: WhyOut = {
    ...meta,
    cluster: { slug: c.slug, id: c.id, first_seen_ts: c.first_seen_ts, label: c.label, status: c.status, top_tags: c.top_tags, n_members: c.members.length, heat: c.heat, links: c.links, summary: c.summary, label_source: c.label_source, narrative: c.narrative, narrative_sub: c.narrative_sub, narrative_mix: c.narrative_mix, flow: c.flow, rank: c.rank, cohorts: c.cohorts, rotating_from: c.rotating_from, rotating_to: c.rotating_to, members: membersOf(a, c, this.store) },
    tags, edges_in: a.edges.filter((e) => e.to === c.slug), edges_out: a.edges.filter((e) => e.from === c.slug),
    rule: "two tokens are linked when weighted Jaccard of their tags ≥ 0.35, or they share ≥ 5 buyers, or they share a deployer and a tag; the meta is the connected component; the slug is its two heaviest tags",
  };
  out.reading = readWhy(out);
  return out;
};

Narra.prototype.wallets = async function (this: Narra, opts: QueryOptions & { cohort?: "sniper" | "sprayer" | "rotator" | "early-in-hot"; sort?: "net_eth" | "tokens" | "buys" | "quote_in" } = {}): Promise<WalletsOut> {
  const { a, meta } = await this.prepare(opts);
  const sort = opts.sort ?? "net_eth";
  let list = [...a.wallets.values()];
  const counts = { wallets: list.length, sniper: 0, sprayer: 0, rotator: 0, "early-in-hot": 0 };
  for (const w of list) for (const c of w.cohorts) counts[c]++;
  if (opts.cohort) list = list.filter((w) => w.cohorts.includes(opts.cohort!));
  if (!opts.all) list = list.filter((w) => w.buys > 0); // sellers of old bags have no entry in the window; --all shows them
  list.sort((x, y) => (y[sort] as number) - (x[sort] as number));
  const out: WalletsOut = { ...meta, cohort: opts.cohort ?? null, sort, wallets: list.slice(0, opts.top ?? 25), counts };
  out.reading = readWallets(out);
  return out;
};

declare module "./narra.js" { interface Narra { walletClusters(opts?: QueryOptions & { top?: number }): Promise<WalletClustersOut> } }
/** Every wallet cluster from one analysis, one answer: the page that maps them needs all four from the same tick. */
Narra.prototype.walletClusters = async function (this: Narra, opts: QueryOptions & { top?: number } = {}): Promise<WalletClustersOut> {
  const { a, meta } = await this.prepare(opts);
  const all = [...a.wallets.values()].filter((w) => w.buys > 0);
  const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const names = ["sniper", "sprayer", "rotator", "early-in-hot"] as const;
  const clusters = names.map((name) => {
    const ws = all.filter((w) => w.cohorts.includes(name)).sort((x, y) => y.quote_in - x.quote_in);
    const metas = new Map<string, number>(); for (const w of ws) for (const c of w.clusters) metas.set(c, (metas.get(c) ?? 0) + 1);
    const overlaps: Record<string, number> = {}; for (const o of names) if (o !== name) overlaps[o] = ws.filter((w) => w.cohorts.includes(o)).length;
    return { name, wallets: ws.length, quote_in: Math.round(ws.reduce((s, w) => s + w.quote_in, 0) * 100) / 100, quote_out: Math.round(ws.reduce((s, w) => s + w.quote_out, 0) * 100) / 100, median_buys: median(ws.map((w) => w.buys)), median_tokens: median(ws.map((w) => w.tokens)), median_entry_sec: median(ws.map((w) => w.median_entry_sec).filter((x): x is number => x !== null)), overlaps, top_metas: [...metas].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([slug, wallets]) => ({ slug, wallets })), members: ws.slice(0, opts.top ?? 5000) };
  });
  const out: WalletClustersOut = { ...meta, wallets_total: all.length, clusters };
  const busiest = [...clusters].sort((x, y) => y.quote_in - x.quote_in)[0];
  const dest = clusters.map((c) => c.top_metas[0]).filter(Boolean).sort((x, y) => y!.wallets - x!.wallets)[0];
  out.reading = `${all.length} wallets bought in the last ${meta.window}: ${clusters.map((c) => `${c.wallets} ${c.name}`).join(", ")}. ${busiest.name} wallets put in the most, ${busiest.quote_in} ETH${dest ? `; ${dest.slug} is where most of them sit (${dest.wallets} wallets)` : ""}.`;
  return out;
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

export interface FindOut { schema_version: typeof SCHEMA_VERSION; query: string; window: WindowKey; clusters: { slug: string; status: string; narrative: string; rank: number; eth: number; buyers: number; why: string }[]; tokens: { token: string; symbol: string; name: string; cluster: string | null; status: string | null; buyers: number; launched_at: number; phase: string }[] }
declare module "./narra.js" { interface Narra { find(text: string, opts?: QueryOptions): Promise<FindOut> } }
Narra.prototype.find = async function (this: Narra, text: string, opts: QueryOptions = {}): Promise<FindOut> {
  const { a } = await this.prepare(opts);
  const q = text.toLowerCase();
  const statuses = new Map(a.clusters.map((c) => [c.slug, c.status]));
  const clusters = a.clusters.flatMap((x) => {
    const why = x.slug.includes(q) ? "slug" : x.label.toLowerCase().includes(q) ? "label" : x.top_tags.some((t) => t.tag.includes(q)) ? "tag" : x.narrative.includes(q) ? "narrative" : "";
    return why ? [{ slug: x.slug, status: x.status, narrative: x.narrative, rank: x.rank, eth: x.heat.quote_norm_in, buyers: x.heat.unique_buyers, why }] : [];
  });
  const tokens = [...a.tokens.values()].filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.token.startsWith(q))
    .map((t) => { const slug = a.membership.get(t.token) ?? null; return { token: t.token, symbol: t.symbol, name: t.name, cluster: slug, status: slug ? statuses.get(slug) ?? null : null, buyers: a.buyers.get(t.token)?.size ?? 0, launched_at: t.launchedTs, phase: t.phase }; })
    .sort((x, y) => y.buyers - x.buyers).slice(0, opts.top ?? 25);
  return { schema_version: SCHEMA_VERSION, query: text, window: opts.window ?? "60m", clusters, tokens };
};

import { computeTrend, clusterHistory, tokenHistory, type TrendOut, type ClusterHistoryRow, type TokenHourRow } from "./analyze/trend.js";
declare module "./narra.js" { interface Narra { trend(hours?: number, step?: number): TrendOut & { reading: string }; history(target: string, hours?: number, window?: WindowKey): { slug?: string; id?: string | null; window?: WindowKey; token?: string; hours: number; snapshots?: ClusterHistoryRow[]; rows?: TokenHourRow[]; reading: string } } }
Narra.prototype.trend = function (this: Narra, hours = 48, step = hours > 24 ? 4 : 1): TrendOut & { reading: string } { const t = computeTrend(this.store, hours, step); return { ...t, reading: readTrend(t) }; };
declare module "./narra.js" { interface Narra { historyFlow(window?: WindowKey, hours?: number, step?: FlowStep, opts?: { backfill?: boolean }): FlowHistoryOut & { reading: string } } }
/** Sampled flow edges per step from the cache (reads only; fills missing ticks from stored trades on first use). */
Narra.prototype.historyFlow = function (this: Narra, window: WindowKey = "60m", hours = 24, step: FlowStep = "1h", opts: { backfill?: boolean } = {}): FlowHistoryOut & { reading: string } {
  const h = flowHistory(this.store, window, hours, step, this.store.stats().newest_trade_ts ?? Math.floor(Date.now() / 1000), opts);
  return { ...h, reading: readFlowHistory(h) };
};
Narra.prototype.history = function (this: Narra, target: string, hours = 24, window: WindowKey = "60m") {
  if (/^0x[0-9a-fA-F]{40}$/.test(target)) { const rows = tokenHistory(this.store, target, hours); return { token: target.toLowerCase(), hours, rows, reading: readTokenHistory(target, rows, hours) }; }
  const snapshots = clusterHistory(this.store, target, hours, undefined, window);
  const slug = target.includes("@") ? target.split("@")[0] : target;
  return { slug, id: target.includes("@") ? target : (snapshots.length ? snapshots[snapshots.length - 1].id ?? null : null), window, hours, snapshots, reading: readClusterHistory(slug, snapshots, hours) };
};
