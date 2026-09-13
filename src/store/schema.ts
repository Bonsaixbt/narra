/** SQLite schema, embedded so the published package needs no extra files. */
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS launches (
  token TEXT PRIMARY KEY,
  curve TEXT NOT NULL UNIQUE,
  deployer TEXT NOT NULL,
  pair TEXT NOT NULL,
  launch_config_id INTEGER NOT NULL DEFAULT 0,
  graduation_threshold TEXT NOT NULL,
  block INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  phase INTEGER NOT NULL DEFAULT 0,
  swept_at INTEGER,
  graduated_at INTEGER,
  position_id TEXT,
  pool_id TEXT
);
CREATE INDEX IF NOT EXISTS launches_ts ON launches(ts);
CREATE INDEX IF NOT EXISTS launches_deployer ON launches(deployer, ts);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  twitter TEXT NOT NULL DEFAULT '',
  telegram TEXT NOT NULL DEFAULT '',
  discord TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  farcaster TEXT NOT NULL DEFAULT '',
  creator_fee_recipient TEXT NOT NULL DEFAULT '',
  creator_tax_bps INTEGER NOT NULL DEFAULT 0,
  buyback_enabled INTEGER NOT NULL DEFAULT 0,
  enriched_at INTEGER NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS pairs (
  address TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS curve_trades (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  curve TEXT NOT NULL,
  token TEXT,
  side TEXT NOT NULL,
  actor TEXT NOT NULL,
  recipient TEXT NOT NULL,
  quote_raw TEXT NOT NULL,
  tokens_raw TEXT NOT NULL,
  fee_raw TEXT NOT NULL,
  tax_raw TEXT NOT NULL,
  quote_norm REAL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS trades_ts ON curve_trades(ts);
CREATE INDEX IF NOT EXISTS trades_token_ts ON curve_trades(token, ts);
CREATE INDEX IF NOT EXISTS trades_curve ON curve_trades(curve);
CREATE INDEX IF NOT EXISTS trades_recipient_ts ON curve_trades(recipient, ts);

CREATE TABLE IF NOT EXISTS pools (
  pool_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  currency0 TEXT NOT NULL,
  currency1 TEXT NOT NULL,
  fee INTEGER NOT NULL,
  tick_spacing INTEGER NOT NULL,
  hooks TEXT NOT NULL,
  init_block INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_swaps (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  pool_id TEXT NOT NULL,
  token TEXT NOT NULL,
  wallet TEXT NOT NULL,
  side TEXT NOT NULL,
  quote_raw TEXT NOT NULL,
  tokens_raw TEXT NOT NULL,
  quote_norm REAL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS swaps_ts ON pool_swaps(ts);
CREATE INDEX IF NOT EXISTS swaps_token_ts ON pool_swaps(token, ts);

CREATE TABLE IF NOT EXISTS cursors (
  stream TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL,
  last_block_hash TEXT
);

CREATE TABLE IF NOT EXISTS cluster_snapshots (
  slug TEXT NOT NULL,
  window TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (slug, window, ts)
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
