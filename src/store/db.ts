import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { SCHEMA } from "./schema.js";

export type Side = "buy" | "sell";
export type PairKind = "eth" | "stable" | "stock" | "other";

export interface LaunchRow {
  token: string; curve: string; deployer: string; pair: string;
  launch_config_id: number; graduation_threshold: string;
  block: number; tx_hash: string; log_index: number; ts: number;
  phase: number; swept_at: number | null; graduated_at: number | null; position_id: string | null; pool_id: string | null;
}
export interface TokenRow {
  token: string; name: string; symbol: string; description: string; logo: string;
  twitter: string; telegram: string; discord: string; website: string; farcaster: string;
  creator_fee_recipient: string; creator_tax_bps: number; buyback_enabled: number; enriched_at: number; error: string | null;
}
export interface PairRow { address: string; symbol: string; decimals: number; kind: PairKind }
export interface TradeRow {
  tx_hash: string; log_index: number; block: number; ts: number; curve: string; token: string | null;
  side: Side; actor: string; recipient: string; quote_raw: string; tokens_raw: string; fee_raw: string; tax_raw: string; quote_norm: number | null;
}
export interface PoolRow { pool_id: string; token: string; currency0: string; currency1: string; fee: number; tick_spacing: number; hooks: string; init_block: number }
export interface SwapRow {
  tx_hash: string; log_index: number; block: number; ts: number; pool_id: string; token: string; wallet: string;
  side: Side; quote_raw: string; tokens_raw: string; quote_norm: number | null;
}
export interface SnapshotRow { slug: string; window: string; ts: number; status: string; payload: string; meta_id?: string | null; first_seen?: number | null }
export type FlowTradeRow = Pick<TradeRow, "ts" | "token" | "side" | "recipient" | "quote_norm" | "tx_hash">;
export interface FlowSnapshotRow { window: string; ts: number; from_slug: string; to_slug: string; wallets: number; quote_norm: number; deployers: number }
export interface HourlyRow { token: string; hour_ts: number; venue: "curve" | "pool"; buys: number; sells: number; quote_in: number; quote_out: number; unique_buyers: number; taxed: number }

export const DEFAULT_DB_PATH = join(homedir(), ".narra", "narra.db");

export function resolveDbPath(p?: string): string {
  if (!p) return DEFAULT_DB_PATH;
  if (p === ":memory:") return p;
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

const lower = (s: string) => s.toLowerCase();

export class Store {
  readonly db: Database.Database;
  readonly path: string;

  constructor(path: string = DEFAULT_DB_PATH) {
    this.path = resolveDbPath(path);
    if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
    // three processes share the file on the server (API, fast worker, slow worker): wait for a writer instead of failing at 5 s
    this.db = new Database(this.path, { timeout: 30_000 });
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Columns added after the first release; CREATE TABLE IF NOT EXISTS does not add them to an existing database. */
  private migrate(): void {
    const cols = new Set((this.db.prepare(`PRAGMA table_info(cluster_snapshots)`).all() as { name: string }[]).map((c) => c.name));
    // meta_id: the identity a slug keeps while its members overlap tick to tick; first_seen: when that identity was born
    if (!cols.has("meta_id")) this.db.exec(`ALTER TABLE cluster_snapshots ADD COLUMN meta_id TEXT`);
    if (!cols.has("first_seen")) this.db.exec(`ALTER TABLE cluster_snapshots ADD COLUMN first_seen INTEGER`);
  }

  close(): void { this.db.close(); }

  // --- launches ------------------------------------------------------------------------------------
  upsertLaunches(rows: LaunchRow[]): number {
    const st = this.db.prepare(`INSERT INTO launches (token, curve, deployer, pair, launch_config_id, graduation_threshold, block, tx_hash, log_index, ts, phase, swept_at, graduated_at, position_id, pool_id)
      VALUES (@token, @curve, @deployer, @pair, @launch_config_id, @graduation_threshold, @block, @tx_hash, @log_index, @ts, @phase, @swept_at, @graduated_at, @position_id, @pool_id)
      ON CONFLICT(token) DO NOTHING`);
    let n = 0;
    this.db.transaction(() => { for (const r of rows) n += st.run({ ...r, token: lower(r.token), curve: lower(r.curve), deployer: lower(r.deployer), pair: lower(r.pair) }).changes; })();
    return n;
  }
  setLifecycle(token: string, patch: Partial<Pick<LaunchRow, "phase" | "swept_at" | "graduated_at" | "position_id" | "pool_id">>): void {
    const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(", ");
    if (!sets) return;
    this.db.prepare(`UPDATE launches SET ${sets} WHERE token = @token`).run({ ...patch, token: lower(token) });
  }
  launch(token: string): LaunchRow | undefined { return this.db.prepare(`SELECT * FROM launches WHERE token = ?`).get(lower(token)) as LaunchRow | undefined; }
  launchesSince(ts: number): LaunchRow[] { return this.db.prepare(`SELECT * FROM launches WHERE ts >= ? ORDER BY ts`).all(ts) as LaunchRow[]; }
  launchesFor(tokens: string[]): LaunchRow[] {
    const out: LaunchRow[] = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500).map(lower);
      out.push(...(this.db.prepare(`SELECT * FROM launches WHERE token IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as LaunchRow[]));
    }
    return out;
  }
  curveToToken(curves: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (let i = 0; i < curves.length; i += 500) {
      const chunk = curves.slice(i, i + 500).map(lower);
      const rows = this.db.prepare(`SELECT curve, token FROM launches WHERE curve IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as { curve: string; token: string }[];
      for (const r of rows) out.set(r.curve, r.token);
    }
    return out;
  }

  // --- tokens & pairs ------------------------------------------------------------------------------
  upsertTokens(rows: TokenRow[]): void {
    const st = this.db.prepare(`INSERT OR REPLACE INTO tokens (token, name, symbol, description, logo, twitter, telegram, discord, website, farcaster, creator_fee_recipient, creator_tax_bps, buyback_enabled, enriched_at, error)
      VALUES (@token, @name, @symbol, @description, @logo, @twitter, @telegram, @discord, @website, @farcaster, @creator_fee_recipient, @creator_tax_bps, @buyback_enabled, @enriched_at, @error)`);
    this.db.transaction(() => { for (const r of rows) st.run({ ...r, token: lower(r.token) }); })();
  }
  tokensFor(tokens: string[]): Map<string, TokenRow> {
    const out = new Map<string, TokenRow>();
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500).map(lower);
      const rows = this.db.prepare(`SELECT * FROM tokens WHERE token IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as TokenRow[];
      for (const r of rows) out.set(r.token, r);
    }
    return out;
  }
  /** Launches that have no token metadata yet (or whose enrich failed more than an hour ago). */
  pendingEnrich(limit: number, now = Math.floor(Date.now() / 1000)): LaunchRow[] {
    return this.db.prepare(`SELECT l.* FROM launches l LEFT JOIN tokens t ON t.token = l.token
      WHERE t.token IS NULL OR (t.error IS NOT NULL AND t.enriched_at < ?) ORDER BY l.ts DESC LIMIT ?`).all(now - 3600, limit) as LaunchRow[];
  }
  upsertPair(row: PairRow): void {
    this.db.prepare(`INSERT OR REPLACE INTO pairs (address, symbol, decimals, kind) VALUES (@address, @symbol, @decimals, @kind)`).run({ ...row, address: lower(row.address) });
  }
  pair(address: string): PairRow | undefined { return this.db.prepare(`SELECT * FROM pairs WHERE address = ?`).get(lower(address)) as PairRow | undefined; }
  pairs(): Map<string, PairRow> { return new Map((this.db.prepare(`SELECT * FROM pairs`).all() as PairRow[]).map((p) => [p.address, p])); }

  // --- trades --------------------------------------------------------------------------------------
  insertTrades(rows: TradeRow[]): number {
    const st = this.db.prepare(`INSERT OR IGNORE INTO curve_trades (tx_hash, log_index, block, ts, curve, token, side, actor, recipient, quote_raw, tokens_raw, fee_raw, tax_raw, quote_norm)
      VALUES (@tx_hash, @log_index, @block, @ts, @curve, @token, @side, @actor, @recipient, @quote_raw, @tokens_raw, @fee_raw, @tax_raw, @quote_norm)`);
    let n = 0;
    this.db.transaction(() => { for (const r of rows) n += st.run({ ...r, curve: lower(r.curve), token: r.token ? lower(r.token) : null, actor: lower(r.actor), recipient: lower(r.recipient) }).changes; })();
    return n;
  }
  tradesSince(ts: number): TradeRow[] { return this.db.prepare(`SELECT * FROM curve_trades WHERE ts >= ? ORDER BY ts`).all(ts) as TradeRow[]; }
  /** The columns flow edges need, nothing else: a quarter of the bytes of tradesBetween over the same span. */
  tradesForFlow(from: number, to: number): FlowTradeRow[] { return this.db.prepare(`SELECT ts, token, side, recipient, quote_norm, tx_hash FROM curve_trades WHERE ts >= ? AND ts < ? AND token IS NOT NULL ORDER BY ts`).all(from, to) as FlowTradeRow[]; }
  tradesBetween(from: number, to: number): TradeRow[] { return this.db.prepare(`SELECT * FROM curve_trades WHERE ts >= ? AND ts < ? ORDER BY ts`).all(from, to) as TradeRow[]; }
  tradesForToken(token: string, limit = 500): TradeRow[] { return this.db.prepare(`SELECT * FROM curve_trades WHERE token = ? ORDER BY ts LIMIT ?`).all(lower(token), limit) as TradeRow[]; }
  tradesForWallet(wallet: string, sinceTs: number): TradeRow[] { return this.db.prepare(`SELECT * FROM curve_trades WHERE recipient = ? AND ts >= ? ORDER BY ts`).all(lower(wallet), sinceTs) as TradeRow[]; }
  swapsForWallet(wallet: string, sinceTs: number): SwapRow[] { return this.db.prepare(`SELECT * FROM pool_swaps WHERE wallet = ? AND ts >= ? ORDER BY ts`).all(lower(wallet), sinceTs) as SwapRow[]; }
  /** Curves with trades but no known launch. */
  unknownCurves(sinceTs: number): string[] {
    return (this.db.prepare(`SELECT DISTINCT curve FROM curve_trades WHERE token IS NULL AND ts >= ?`).all(sinceTs) as { curve: string }[]).map((r) => r.curve);
  }
  resolveTradeTokens(): number {
    return this.db.prepare(`UPDATE curve_trades SET token = (SELECT token FROM launches WHERE launches.curve = curve_trades.curve) WHERE token IS NULL AND curve IN (SELECT curve FROM launches)`).run().changes;
  }
  setQuoteNorm(rows: { tx_hash: string; log_index: number; quote_norm: number | null }[]): void {
    const st = this.db.prepare(`UPDATE curve_trades SET quote_norm = @quote_norm WHERE tx_hash = @tx_hash AND log_index = @log_index`);
    this.db.transaction(() => { for (const r of rows) st.run(r); })();
  }

  // --- pools ---------------------------------------------------------------------------------------
  upsertPool(row: PoolRow): void {
    this.db.prepare(`INSERT OR REPLACE INTO pools (pool_id, token, currency0, currency1, fee, tick_spacing, hooks, init_block) VALUES (@pool_id, @token, @currency0, @currency1, @fee, @tick_spacing, @hooks, @init_block)`)
      .run({ ...row, pool_id: lower(row.pool_id), token: lower(row.token), currency0: lower(row.currency0), currency1: lower(row.currency1), hooks: lower(row.hooks) });
  }
  pools(): Map<string, PoolRow> { return new Map((this.db.prepare(`SELECT * FROM pools`).all() as PoolRow[]).map((p) => [p.pool_id, p])); }
  insertSwaps(rows: SwapRow[]): number {
    const st = this.db.prepare(`INSERT OR IGNORE INTO pool_swaps (tx_hash, log_index, block, ts, pool_id, token, wallet, side, quote_raw, tokens_raw, quote_norm)
      VALUES (@tx_hash, @log_index, @block, @ts, @pool_id, @token, @wallet, @side, @quote_raw, @tokens_raw, @quote_norm)`);
    let n = 0;
    this.db.transaction(() => { for (const r of rows) n += st.run({ ...r, pool_id: lower(r.pool_id), token: lower(r.token), wallet: lower(r.wallet) }).changes; })();
    return n;
  }
  swapsForToken(token: string, sinceTs: number): SwapRow[] { return this.db.prepare(`SELECT * FROM pool_swaps WHERE token = ? AND ts >= ? ORDER BY ts`).all(lower(token), sinceTs) as SwapRow[]; }
  swapsSince(ts: number): SwapRow[] { return this.db.prepare(`SELECT * FROM pool_swaps WHERE ts >= ? ORDER BY ts`).all(ts) as SwapRow[]; }
  swapsBetween(from: number, to: number): SwapRow[] { return this.db.prepare(`SELECT * FROM pool_swaps WHERE ts >= ? AND ts < ? ORDER BY ts`).all(from, to) as SwapRow[]; }

  // --- cursors, snapshots, kv ----------------------------------------------------------------------
  getCursor(stream: string): { last_block: number; last_block_hash: string | null } | undefined {
    return this.db.prepare(`SELECT last_block, last_block_hash FROM cursors WHERE stream = ?`).get(stream) as { last_block: number; last_block_hash: string | null } | undefined;
  }
  setCursor(stream: string, last_block: number, last_block_hash: string | null = null): void {
    this.db.prepare(`INSERT OR REPLACE INTO cursors (stream, last_block, last_block_hash) VALUES (?, ?, ?)`).run(stream, last_block, last_block_hash);
  }
  saveSnapshots(rows: SnapshotRow[]): void {
    const st = this.db.prepare(`INSERT OR REPLACE INTO cluster_snapshots (slug, window, ts, status, payload, meta_id, first_seen) VALUES (@slug, @window, @ts, @status, @payload, @meta_id, @first_seen)`);
    this.db.transaction(() => { for (const r of rows) st.run({ meta_id: null, first_seen: null, ...r }); })();
  }
  snapshots(slug: string, window: string, sinceTs: number): SnapshotRow[] {
    return this.db.prepare(`SELECT * FROM cluster_snapshots WHERE slug = ? AND window = ? AND ts >= ? ORDER BY ts`).all(slug, window, sinceTs) as SnapshotRow[];
  }
  /** Every cluster of one tick. */
  snapshotsAt(window: string, ts: number): SnapshotRow[] {
    return this.db.prepare(`SELECT * FROM cluster_snapshots WHERE window = ? AND ts = ? ORDER BY slug`).all(window, ts) as SnapshotRow[];
  }
  /** Tick times that have cluster snapshots, ascending. */
  snapshotTicks(window: string, sinceTs: number): number[] {
    return (this.db.prepare(`SELECT DISTINCT ts FROM cluster_snapshots WHERE window = ? AND ts >= ? ORDER BY ts`).all(window, sinceTs) as { ts: number }[]).map((r) => r.ts);
  }
  /** One tick's flow edges: the tick row plus its edges, atomically. */
  saveFlowSnapshot(window: string, ts: number, edges: { from: string; to: string; wallets: number; quote_norm: number; deployers: number }[]): void {
    const tick = this.db.prepare(`INSERT OR REPLACE INTO flow_ticks (window, ts, edges) VALUES (?, ?, ?)`);
    const del = this.db.prepare(`DELETE FROM flow_snapshots WHERE window = ? AND ts = ?`);
    const ins = this.db.prepare(`INSERT OR REPLACE INTO flow_snapshots (window, ts, from_slug, to_slug, wallets, quote_norm, deployers) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.db.transaction(() => { tick.run(window, ts, edges.length); del.run(window, ts); for (const e of edges) ins.run(window, ts, e.from, e.to, e.wallets, e.quote_norm, e.deployers); })();
  }
  flowTicks(window: string, sinceTs: number): number[] {
    return (this.db.prepare(`SELECT ts FROM flow_ticks WHERE window = ? AND ts >= ? ORDER BY ts`).all(window, sinceTs) as { ts: number }[]).map((r) => r.ts);
  }
  flowEdgesAt(window: string, ts: number): FlowSnapshotRow[] {
    return this.db.prepare(`SELECT * FROM flow_snapshots WHERE window = ? AND ts = ? ORDER BY wallets DESC, deployers DESC`).all(window, ts) as FlowSnapshotRow[];
  }
  latestSnapshots(window: string): SnapshotRow[] {
    return this.db.prepare(`SELECT s.* FROM cluster_snapshots s JOIN (SELECT slug, MAX(ts) ts FROM cluster_snapshots WHERE window = ? GROUP BY slug) m ON m.slug = s.slug AND m.ts = s.ts WHERE s.window = ?`).all(window, window) as SnapshotRow[];
  }
  /** Reorg rewind: forget everything read at or after `block`; launches keep their rows (a re-read upserts them). */
  dropFromBlock(block: number): { trades: number; swaps: number } {
    const trades = this.db.prepare(`DELETE FROM curve_trades WHERE block >= ?`).run(block).changes;
    const swaps = this.db.prepare(`DELETE FROM pool_swaps WHERE block >= ?`).run(block).changes;
    this.db.prepare(`DELETE FROM launches WHERE block >= ?`).run(block);
    return { trades, swaps };
  }
  minBlock(table: "curve_trades" | "pool_swaps"): number | null { return (this.db.prepare(`SELECT MIN(block) b FROM ${table}`).get() as { b: number | null }).b; }
  get(key: string): string | undefined { return (this.db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined)?.value; }
  set(key: string, value: string): void { this.db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`).run(key, value); }

  // --- semantic ------------------------------------------------------------------------------------
  embeddingsFor(tokens: string[], model: string): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500).map(lower);
      const rows = this.db.prepare(`SELECT token, dim, vec FROM embeddings WHERE model = ? AND token IN (${chunk.map(() => "?").join(",")})`).all(model, ...chunk) as { token: string; dim: number; vec: Buffer }[];
      for (const r of rows) out.set(r.token, new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dim));
    }
    return out;
  }
  putEmbeddings(rows: { token: string; model: string; vec: Float32Array }[]): void {
    const st = this.db.prepare(`INSERT OR REPLACE INTO embeddings (token, model, dim, vec) VALUES (?, ?, ?, ?)`);
    this.db.transaction(() => { for (const r of rows) st.run(lower(r.token), r.model, r.vec.length, Buffer.from(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength)); })();
  }
  embeddingCount(model?: string): number {
    const row = (model ? this.db.prepare(`SELECT COUNT(*) n FROM embeddings WHERE model = ?`).get(model) : this.db.prepare(`SELECT COUNT(*) n FROM embeddings`).get()) as { n: number };
    return row.n;
  }
  getClusterLabel(memberKey: string, model: string): { label: string; summary: string } | undefined {
    return this.db.prepare(`SELECT label, summary FROM cluster_labels WHERE member_key = ? AND model = ?`).get(memberKey, model) as { label: string; summary: string } | undefined;
  }
  putClusterLabel(memberKey: string, model: string, label: string, summary: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO cluster_labels (member_key, model, label, summary, ts) VALUES (?, ?, ?, ?, ?)`).run(memberKey, model, label, summary, Math.floor(Date.now() / 1000));
  }

  // --- housekeeping --------------------------------------------------------------------------------
  /** Rows older than the retention are folded into per-token hourly aggregates before they are deleted, so history survives. */
  prune(retentionHours: number, now = Math.floor(Date.now() / 1000)): { trades: number; swaps: number; hours: number } {
    const cutoff = now - retentionHours * 3600;
    const hours = this.compact(cutoff);
    const trades = this.db.prepare(`DELETE FROM curve_trades WHERE ts < ?`).run(cutoff).changes;
    const swaps = this.db.prepare(`DELETE FROM pool_swaps WHERE ts < ?`).run(cutoff).changes;
    // cluster snapshots: 15m ticks are noise after two days, everything after 30 days; calibration reads 60m/4h within that
    this.db.prepare(`DELETE FROM cluster_snapshots WHERE ts < ? OR (window = '15m' AND ts < ?)`).run(now - 30 * 86_400, now - 2 * 86_400);
    for (const t of ["flow_snapshots", "flow_ticks"]) this.db.prepare(`DELETE FROM ${t} WHERE ts < ? OR (window = '15m' AND ts < ?)`).run(now - 30 * 86_400, now - 2 * 86_400);
    // keep the WAL from growing without bound after big writes
    try { this.db.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch { /* another connection may hold it */ }
    return { trades, swaps, hours };
  }
  compact(beforeTs: number): number {
    const hourOf = "(ts / 3600) * 3600";
    const curve = this.db.prepare(`INSERT OR REPLACE INTO hourly (token, hour_ts, venue, buys, sells, quote_in, quote_out, unique_buyers, taxed)
      SELECT token, ${hourOf}, 'curve', SUM(side = 'buy'), SUM(side = 'sell'), COALESCE(SUM(CASE WHEN side = 'buy' THEN quote_norm END), 0), COALESCE(SUM(CASE WHEN side = 'sell' THEN quote_norm END), 0),
             COUNT(DISTINCT CASE WHEN side = 'buy' THEN recipient END), SUM(side = 'buy' AND CAST(tax_raw AS INTEGER) > 0)
      FROM curve_trades WHERE token IS NOT NULL AND ts < ? GROUP BY token, ${hourOf}`).run(beforeTs).changes;
    const pool = this.db.prepare(`INSERT OR REPLACE INTO hourly (token, hour_ts, venue, buys, sells, quote_in, quote_out, unique_buyers, taxed)
      SELECT token, ${hourOf}, 'pool', SUM(side = 'buy'), SUM(side = 'sell'), COALESCE(SUM(CASE WHEN side = 'buy' THEN quote_norm END), 0), COALESCE(SUM(CASE WHEN side = 'sell' THEN quote_norm END), 0),
             COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END), 0
      FROM pool_swaps WHERE ts < ? GROUP BY token, ${hourOf}`).run(beforeTs).changes;
    return curve + pool;
  }
  hourlyFor(tokens: string[], sinceTs: number): HourlyRow[] {
    if (!tokens.length) return [];
    return this.db.prepare(`SELECT * FROM hourly WHERE hour_ts >= ? AND token IN (${tokens.map(() => "?").join(",")}) ORDER BY hour_ts`).all(sinceTs, ...tokens.map(lower)) as HourlyRow[];
  }
  snapshotHistory(slug: string, sinceTs: number): SnapshotRow[] {
    return this.db.prepare(`SELECT * FROM cluster_snapshots WHERE slug = ? AND ts >= ? ORDER BY ts`).all(slug, sinceTs) as SnapshotRow[];
  }
  stats(): { launches: number; tokens: number; trades: number; swaps: number; pools: number; snapshots: number; hourly: number; oldest_trade_ts: number | null; newest_trade_ts: number | null } {
    const c = (t: string) => (this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    const r = this.db.prepare(`SELECT MIN(ts) a, MAX(ts) b FROM curve_trades`).get() as { a: number | null; b: number | null };
    return { launches: c("launches"), tokens: c("tokens"), trades: c("curve_trades"), swaps: c("pool_swaps"), pools: c("pools"), snapshots: c("cluster_snapshots"), hourly: c("hourly"), oldest_trade_ts: r.a, newest_trade_ts: r.b };
  }
}
