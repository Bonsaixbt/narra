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
export interface SnapshotRow { slug: string; window: string; ts: number; status: string; payload: string }

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
    this.db = new Database(this.path);
    this.db.exec(SCHEMA);
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
    if (!tokens.length) return [];
    return this.db.prepare(`SELECT * FROM launches WHERE token IN (${tokens.map(() => "?").join(",")})`).all(...tokens.map(lower)) as LaunchRow[];
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
  tradesBetween(from: number, to: number): TradeRow[] { return this.db.prepare(`SELECT * FROM curve_trades WHERE ts >= ? AND ts < ? ORDER BY ts`).all(from, to) as TradeRow[]; }
  tradesForToken(token: string, limit = 500): TradeRow[] { return this.db.prepare(`SELECT * FROM curve_trades WHERE token = ? ORDER BY ts LIMIT ?`).all(lower(token), limit) as TradeRow[]; }
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
    const st = this.db.prepare(`INSERT OR REPLACE INTO cluster_snapshots (slug, window, ts, status, payload) VALUES (@slug, @window, @ts, @status, @payload)`);
    this.db.transaction(() => { for (const r of rows) st.run(r); })();
  }
  snapshots(slug: string, window: string, sinceTs: number): SnapshotRow[] {
    return this.db.prepare(`SELECT * FROM cluster_snapshots WHERE slug = ? AND window = ? AND ts >= ? ORDER BY ts`).all(slug, window, sinceTs) as SnapshotRow[];
  }
  latestSnapshots(window: string): SnapshotRow[] {
    return this.db.prepare(`SELECT s.* FROM cluster_snapshots s JOIN (SELECT slug, MAX(ts) ts FROM cluster_snapshots WHERE window = ? GROUP BY slug) m ON m.slug = s.slug AND m.ts = s.ts WHERE s.window = ?`).all(window, window) as SnapshotRow[];
  }
  get(key: string): string | undefined { return (this.db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined)?.value; }
  set(key: string, value: string): void { this.db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`).run(key, value); }

  // --- housekeeping --------------------------------------------------------------------------------
  prune(retentionHours: number, now = Math.floor(Date.now() / 1000)): { trades: number; swaps: number } {
    const cutoff = now - retentionHours * 3600;
    const trades = this.db.prepare(`DELETE FROM curve_trades WHERE ts < ?`).run(cutoff).changes;
    const swaps = this.db.prepare(`DELETE FROM pool_swaps WHERE ts < ?`).run(cutoff).changes;
    return { trades, swaps };
  }
  stats(): { launches: number; tokens: number; trades: number; swaps: number; pools: number; snapshots: number; oldest_trade_ts: number | null; newest_trade_ts: number | null } {
    const c = (t: string) => (this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    const r = this.db.prepare(`SELECT MIN(ts) a, MAX(ts) b FROM curve_trades`).get() as { a: number | null; b: number | null };
    return { launches: c("launches"), tokens: c("tokens"), trades: c("curve_trades"), swaps: c("pool_swaps"), pools: c("pools"), snapshots: c("cluster_snapshots"), oldest_trade_ts: r.a, newest_trade_ts: r.b };
  }
}
