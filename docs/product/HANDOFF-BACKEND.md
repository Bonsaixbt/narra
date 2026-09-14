# narra — backend handoff

For whoever runs or extends the hosted service. `HANDOFF-FRONTEND.md` is the contract the site is built against; this file is everything behind it.

## 1. What exists

Two packages in one repository:

| Package | Path | Role |
|---|---|---|
| `narra-cli` | repo root | the engine: chain ingest, SQLite cache, clustering, statuses, flow, wallets, narratives, verdicts, semantic layer, CLI, MCP. Published to npm as `narra-cli`. |
| `narra-service` | `service/` | the engine as an HTTP + SSE service for the site: cached analyses per window, holder gate, rate limits, delayed public stream, share cards, Docker. Private, not published. |

The service computes nothing of its own. Every number it returns is the same the terminal prints; if a value looks wrong, reproduce it with `narra now --json` on the same cache before touching the service.

## 2. Run it

```sh
git clone https://github.com/Bonsaixbt/narra && cd narra
cp .env.example .env            # NARRA_RPC_URL and NARRA_WS_URL: the private node first, the public node as fallback
npm install && npm run build
cd service && cp .env.example .env && npm install
npm run dev                     # http://127.0.0.1:4663/api/health
```

The first tick fills the cache for the deepest configured window (`NARRA_WINDOWS`, default `60m,15m,4h`); on a private node that is a few minutes, on public RPCs longer. `/api/health` returns `503 WARMING_UP`-shaped `ok:false` until the first analysis exists, then `ok:true` with `snapshot_age_s`, `lag_blocks`, `ticks`, `last_error`.

Production: `cd service && docker compose up -d`. The image builds the library and the service; `./data` holds the SQLite cache (plan ~620 MB per day of raw trades at 7-day retention, ~4.5 GB steady state); a sidecar writes an hourly `sqlite3 .backup` into `./backups` and keeps 7 days. Bind the port to localhost and put a TLS reverse proxy (Caddy, nginx) in front. Set `NARRA_API_ORIGIN` to the site's origin so CORS and the holder cookie work.

## 3. How it is built

```
service/src/
  config.ts     env → CONFIG; gateEnabled() = token address and HMAC secret both set
  engine.ts     one Narra; loop: sync the deepest window → prepare() per window → cache {a, meta, at}; 60m diffs into events; websocket wakes it (≥10 s apart)
  index.ts      Hono app: middleware (CORS, IP, holder cookie, rate limit) → routes; every route answers from the cached analysis via narra-cli's QueryOptions.analysis
  gate.ts       readBalance() through viem; issueToken()/verifyToken(): base64url payload + HMAC-SHA256, 24 h TTL, constant-time compare
  ratelimit.ts  token bucket per IP (anonymous) or per holder address
  stream.ts     SSE hub: holders immediately, anonymous after NARRA_PUBLIC_STREAM_DELAY_S; SYNC heartbeats are never delayed
  og.ts         SVG share cards (1200×630) for a meta and a token; PNG through @resvg/resvg-js (optional dependency)
  alerts.ts     Telegram: STATUS→HOT/ROTATING, EDGE ≥ 8 wallets, GRAD; dedupe per key, per-minute cap, optional delay
  bot.ts        community bot: change-driven digest to the community chats (hard max gap 4× the interval); /meta /coin (≤3 addresses) /why /find /flow /trend /help from the cached analyses; replies in groups; per-user rate limit; Telegram 429 backoff; long polling
test/           gate round-trip and tampering, limiter refill, stream delay
```

The engine keeps at most three analyses in memory. `60m` and `15m` are recomputed every tick (`NARRA_TICK_S`, 30 s); `4h` at most every `NARRA_SLOW_WINDOW_EVERY_S` (300 s) because it takes ~25 s of CPU. Two child processes do the work: the fast one syncs and recomputes `60m`/`15m` every tick, the slow one owns `4h` and the trend, so a 200 s `4h` pass never lets the fast windows go stale (health flips to 503 when `60m` is older than `NARRA_STALE_AFTER_S`). Requests are served from the cache, so a request never triggers analysis. The slow worker precomputes `/api/trend` (48 h in 4 h steps, every `NARRA_TREND_EVERY_S`): the aggregate is seconds of SQL over the trade tables and, before it moved, it blocked every other route for a minute per call. Other spans are refused with `BAD_TREND` (the CLI answers them). Every tick also writes its flow edges (`flow_ticks`, `flow_snapshots`, same retention as `cluster_snapshots`) for `/api/history/flow`; the slow worker backfills the last 24 h of sampled ticks from stored trades at startup, so the route is never empty after an upgrade. Cluster snapshots carry `meta_id`/`first_seen` (added by an in-place migration), the identity behind the `id` field on every cluster. Every tick also stores cluster snapshots in the cache: that is the calibration data for `narra calibrate`.

Library entry points the service relies on (all exported from `narra-cli`): `Narra` with `sync`, `prepare`, `now`, `coin`, `find`, `why`, `flow`, `wallets`, `wallet`, `trend`, `history`, `doctor`; `diffEvents`, `liveTrigger`, `loadEnv`, `SCHEMAS`, `jsonSchema`. `QueryOptions.analysis` is the hook that lets the service answer from a cached analysis.

## 4. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NARRA_RPC_URL`, `NARRA_WS_URL` | public nodes | from the engine; a private archive node is strongly recommended |
| `NARRA_DB` | `~/.narra/narra.db` (`/data/narra.db` in Docker) | cache path |
| `NARRA_RETENTION_H` | 24 (set 168 for the service) | raw-trade retention; older rows fold into hourly aggregates |
| `NARRA_API_PORT` / `NARRA_API_HOST` | 4663 / 0.0.0.0 | listen address |
| `NARRA_API_ORIGIN` | empty (any) | CORS origin; `https://narrahood.com` in production |
| `NARRA_TOKEN_ADDRESS` | empty | `$NARRA` contract; empty keeps every route open |
| `NARRA_HOLDER_THRESHOLD` | 500000 | whole tokens needed for holder mode |
| `NARRA_HOLDER_SECRET` | empty | HMAC secret; generate 32+ random bytes; rotating it logs every holder out |
| `NARRA_HOLDER_TTL_S` | 86400 | cookie lifetime |
| `NARRA_RATE_ANON` / `NARRA_RATE_HOLDER` | 60 / 600 | requests per minute |
| `NARRA_PUBLIC_STREAM_DELAY_S` | 300 | how late anonymous SSE viewers see events |
| `NARRA_TICK_S` | 30 | analysis interval |
| `NARRA_WINDOWS` | `60m,15m,4h` | windows to keep; drop `4h` on a small box |
| `NARRA_SLOW_WINDOW_EVERY_S` | 300 | recompute interval for `4h` |
| `NARRA_TREND_EVERY_S` | 900 | recompute interval for the precomputed `/api/trend` (48 h, 4 h steps) |
| `NARRA_STALE_AFTER_S` / `NARRA_MAX_LAG_BLOCKS` | 180 / 300 | health thresholds |
| `NARRA_SEMANTIC*` | off | the semantic layer, see the root `.env.example`; naming needs a model key (OpenRouter free models work) |
| `NARRA_TG_BOT_TOKEN`, `NARRA_TG_CHAT_IDS`, `NARRA_TG_EVENTS`, `NARRA_TG_DEDUPE_S`, `NARRA_TG_PER_MINUTE`, `NARRA_TG_DELAY_S` | off | Telegram alerts to fixed chats |
| `NARRA_TG_COMMUNITY_CHAT_IDS`, `NARRA_TG_ALLOWED_CHAT_IDS`, `NARRA_TG_DIGEST_EVERY_S`, `NARRA_TG_COMMANDS` | off | the community bot (digest + commands) |

## 5. Turning the gate on (launch day)

1. Put the token contract in `NARRA_TOKEN_ADDRESS`, a long random `NARRA_HOLDER_SECRET`, the threshold, restart.
2. `POST /api/holders/check { address }` now reads `balanceOf` on chain; a balance at or above the threshold returns `ok:true`, sets the `narra_holder` cookie and also returns the token in the body for clients that cannot keep cookies (send it as `x-narra-holder`).
3. Gated routes and the `15m`/`4h` windows start answering `401 HOLDER_REQUIRED` without a valid cookie. The public stream keeps working with the delay.
4. Nothing else changes; the site's proxy forwards the cookie as is.

There is no signature anywhere in this flow. Anyone can claim any address; the gate protects against casual freeloading, not against a determined user pasting a whale's address. That is by design: the data is public anyway and the site must never ask for a wallet connection.

## 6. Operating it

- **Health**: poll `/api/health` every minute; `ok:false` means the snapshot is older than `NARRA_STALE_AFTER_S`, the cursor lags more than `NARRA_MAX_LAG_BLOCKS`, or the last tick threw (`last_error`).
- **Logs**: one line at start; errors land in `last_error`. Add a log shipper on the container's stderr if you need history.
- **Restart**: safe at any moment; the cursor and cache are in SQLite; the first tick after a restart catches up from the cursor.
- **Cache growth**: `narra cache stats`, `narra cache vacuum` (checkpoints the WAL and compacts); retention is enforced on every tick.
- **Reorgs**: the cursor stores the block hash; a mismatch rewinds 200 blocks automatically.
- **RPC budget**: subscriptions plus a few `eth_getLogs` per minute plus one multicall per launch; single-digit millions of calls a month on Chainstack.
- **Calibration**: after a few days of ticks, run `narra calibrate --window 60m --hours 168 --write` on the same cache (the CLI, pointed at the service's DB), commit the new `thresholds.json`, rebuild.

## 7. Contract with the frontend

The response shapes are the zod schemas in `narra-cli` (`src/schemas.ts`, generated into `schemas/*.json`). Rules:

- Fields never disappear within `schema_version` 1.x; add, never rename.
- New endpoints go under `/api` and answer JSON with the same `{ error: { code, message } }` shape on failure.
- Anything the site needs derived from the data belongs in the library, not in the site: add a method on `Narra`, expose it in `src/lib.ts`, add a route.

## 8. Post-launch backlog (agreed 2026-09-13, build after the token launch)

| Feature | Shape |
|---|---|
| Personal watchlist | per holder address (from the cookie): metas and tokens to follow; status changes surface in the stream and, per user, in Telegram |
| Frozen snapshots | `POST /api/snapshot` → `/api/snapshot/:id`: a board or a card frozen at that moment, for posts that must not drift |
| Home summary in one call | `/api/summary`: hottest, draining, narratives, top 5, latest events — one request for the first paint |
| Per-holder Telegram subscriptions | a bot conversation that checks an address and subscribes the user to their watchlist |

## 9. What is left

| Task | Notes |
|---|---|
| Deploy | `service/deploy/VPS.md` and `deploy/Caddyfile`: docker compose, Caddy TLS, `NARRA_API_ORIGIN`, uptime ping on `/api/health` |
| Threshold calibration | needs days of snapshots; the tool exists |
| Multi-process | one process is enough today; if a second writer is ever needed, move the cache to Postgres — the store layer is the only place that knows SQLite |
