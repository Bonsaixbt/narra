# NARRA — backend spec (phase 2, the hosted product)

Date: 2026-09-13
Product: the hosted service behind the narra terminal for Pons v2 / Robinhood Chain
Status: implemented in `service/` (Hono): engine loop with cached analyses per window, holder gate, rate limits, SSE with a public delay, SVG share cards, Docker + hourly backups. Remaining: PNG rasteriser for X previews, Telegram alerts, deployment on a VPS.

Related: `docs/OSS.md` (phase 1, the open terminal), `docs/GUIDE.md`, `docs/FRONTEND.md` (the site).

Phase 2 imports `narrahood` as a dependency: the ingest, analysis and schemas are the same code. What the service adds is what a local install cannot have — history beyond the local retention, alerts, a site, a holder gate.

---

## 0. Principles

1. All code is ours. Other repositories are not copied or ported. Public facts about the chain and contracts are used freely.
2. Every number on the screen opens down to its source: event, block, transaction. No "the AI saw a rotation".
3. No key. The backend signs nothing and sends no transactions. The only private thing in the config is the RPC URL.
4. A verdict always comes with reasons. `IN` does not mean "buy".
5. One process on day 0. Indexer, analyser and API live in one Node process; no queues before they are needed.

---

## 1. What the backend answers

| Question | Command / endpoint |
|---|---|
| Which meta is hot right now | `narra now`, `GET /api/board` |
| Where capital is rotating | `narra flow`, `GET /api/flow` |
| Is this CA in a meta and why | `narra coin <CA>`, `GET /api/coin/:ca` |
| What happened in the last minutes | `narra watch`, `GET /api/stream` (SSE) |
| Why a cluster is named like that | `narra why <cluster>`, `GET /api/cluster/:id` |

Does not answer: "buy or not", "how much of my bag exits", "who is a smart wallet".

---

## 2. Chain and protocol facts

Public constants, checked at startup by `narra doctor` against the live chain; a mismatch prints a warning.

| Parameter | Value |
|---|---|
| Network | Robinhood Chain mainnet, chainId `4663`, Arbitrum stack, ~100 ms blocks, gas in ETH |
| Paid RPC | Chainstack, archive, HTTPS + WSS. The only source for backfill and subscriptions |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` — fallback only for `eth_call` and short `eth_getLogs` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Pons v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Pons meme hook | read from `factory.memeHook()` at startup, never hardcoded |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Graduation threshold (config 0) | 4.2 ETH of real quote, phantom reserve 1.68 ETH; stable and stock pairs carry their own thresholds |
| Opening tax | 99 % at t=0, decays to 0 in 3 s |
| Supply | 1 000 000 000 × 1e18 |
| Tempo | ~20–40k launches and ~600 graduations a day; ~8 curve buys per second chain-wide (measured 2026-09-13) |

Events, view functions, topics and the sync mechanics are documented in `docs/PONS.md` and implemented in `narrahood`.

---

## 3. Architecture

```
                      ┌───────────────────────────────────────────┐
  Chainstack WSS ───▶ │  ingest (narrahood)                       │
  Chainstack HTTPS ─▶ │   launches · curveTrades · lifecycle ·    │
  public RPC (fb) ──▶ │   poolSwaps · enrich · pairs · backfill   │
                      └───────────────┬───────────────────────────┘
                                      ▼
                            SQLite (WAL) — raw events + metadata + hourly + snapshots
                                      ▼
                      ┌───────────────────────────────────────────┐
                      │  analyze (narrahood), tick every 30 s     │
                      │   tokenize → cluster → heat → status →    │
                      │   flow → wallets → narrative → snapshots  │
                      └───────────────┬───────────────────────────┘
                                      ▼
                     ┌────────────┬───────────────┬──────────────┐
                     │  CLI       │  HTTP API     │  SSE stream  │
                     │  narra *   │  /api/*       │  /api/stream │
                     └────────────┴───────────────┴──────────────┘
```

Modes:

- `narra serve` — indexer + analyser + API. A long-lived process on a VPS (needs a persistent WebSocket subscription, so not a serverless function).
- The site talks to the API; a user of the open repo runs their own node with the same binary.

Stack: Node 22 LTS, TypeScript, `narrahood` as a library, `better-sqlite3`, `hono` for HTTP, `zod` for response schemas. No ORM. Tests with `node:test`.

---

## 4. RPC layer

Implemented in `narrahood` (`src/chain/rpc.ts`): endpoint list with capabilities, single requests (no JSON-RPC batching), per-endpoint concurrency, a 5 s bench on 429/503 and 60 s on a Cloudflare challenge, a learned block-range cap with automatic splitting, WSS subscription with a watchdog. Metrics (calls per method, refusals, block lag) are exposed on `/api/health`.

---

## 5. Ingest

Implemented in `narrahood`. Streams: `launches`, `curve_trades`, `lifecycle`, `pool_init`, `pool_swaps`, `enrich`, `pairs`. One cursor per stream family; 2 000-block chunks; timestamps interpolated between chunk edges; deduplication on `(tx_hash, log_index)`; reorg check via the cursor block hash with a 200-block rewind.

Wallet attribution: `recipient` on curves; the end of the token's `Transfer` chain from or to the PoolManager in pools, skipping the hook's fee leg.

Quote normalisation: ETH as is; stables via ETH/USD; stock-token pairs stay null until a price source exists. The API always returns both raw and normalised values.

---

## 6. Database

The `narrahood` schema plus service-only tables:

```sql
-- from narrahood
launches, tokens, pairs, curve_trades, curve_snapshots, pools, pool_swaps, hourly, cursors,
cluster_snapshots, embeddings, cluster_labels, kv

-- service
holders(address PK, balance TEXT, checked_at)
alerts(id PK, kind TEXT, target TEXT, chat TEXT, created_at)
api_keys(key PK, tier TEXT, created_at)
```

Retention on the service: raw trades 7 days (`NARRA_RETENTION_H=168`); hourly aggregates and cluster snapshots forever. Volume: ~620 MB of raw trades per day measured, ~4.3 GB for 7 days. Fine for SQLite on an NVMe VPS; move to Postgres only if a second writer appears.

---

## 7. Analysis

Implemented in `narrahood` and described in `docs/STRATEGY.md`: tokenisation, clustering with the size guard and the launch-farm rule, heat, statuses, flow, wallet cohorts, narratives, verdicts, the optional semantic layer.

Service-side additions:

- Tick every 30 s for `15m`, `60m` and `4h`; snapshots stored for every tick (the calibration data).
- `24h` and `7d` boards computed from hourly aggregates once an hour.
- Thresholds calibrated with `narra calibrate --write` and versioned in the repo with their date.

---

## 8. Metas after graduation

Implemented: pools after graduation are indexed through `Initialize` and `Swap` on the PoolManager; pool volume and buyers count in heat; the card shows `pool` phase and volume; `graduated_share` is a verdict reason for late launches. Limitations: the `swept` gap between the curve and the pool has zero volume; swaps from contracts are attributed to the router and marked unattributed; USD prices for pools come from DexScreener with a 60 s cache and a source label.

---

## 9. HTTP API

Base path `/api`. All answers are JSON validated by the `narrahood` zod schemas, exported for the frontend. Errors: `{ error: { code, message } }`.

| Method | Path | Answer | Gate |
|---|---|---|---|
| GET | `/health` | indexer lag, head, RPC state, time of the last tick | no |
| GET | `/board?window=60m&pair=all` | `NowOut` | no for 60m; `15m` and `4h` — holders |
| GET | `/cluster/:slug?window=60m` | `WhyOut` | no |
| GET | `/coin/:ca` | `CoinOut` | no |
| GET | `/find?q=` | `FindOut` | no |
| GET | `/flow?window=60m` | `FlowOut` | holders |
| GET | `/wallets?cohort=` · `/wallet/:address` | `WalletsOut` · `WalletOut` | holders |
| GET | `/history/cluster/:slug?days=7` · `/trend?hours=48` | snapshots, hourly trend | holders |
| GET | `/stream` | SSE: `LAUNCH`, `STATUS`, `EDGE`, `GRAD`, `JOIN` | holders (public with a 5-minute delay) |
| POST | `/holders/check` | `{ address }` → `{ balance, threshold, ok }` | no |
| GET | `/og/cluster/:slug.png`, `/og/coin/:ca.png` | PNG cards for X previews | no |

Holder gate: `POST /holders/check` reads `balanceOf(address)` on the `$NARRA` contract (`NARRA_TOKEN_ADDRESS`; empty before launch, then every endpoint is open). The answer is signed with a short 24 h HMAC token the frontend stores in a cookie and sends as `x-narra-holder`. No wallet signature, no `personal_sign`. Threshold `NARRA_HOLDER_THRESHOLD` in tokens.

Limits: 60 requests/min per IP without the gate, 600 with it. SSE: 1 connection per IP without the gate. CORS: the site's origin only.

---

## 10. CLI

The `narrahood` binary. Service-specific: `narra serve` with `--public` (rate limits, CORS, holder gate) and alert workers.

---

## 11. Configuration

```
NARRA_RPC_URL=https://<chainstack>/<key>,https://rpc.mainnet.chain.robinhood.com
NARRA_WS_URL=wss://<chainstack>/ws/<key>
NARRA_DB=./data/narra.db
NARRA_API_PORT=4663
NARRA_API_ORIGIN=https://narra.example
NARRA_TOKEN_ADDRESS=            # empty before launch
NARRA_HOLDER_THRESHOLD=500000
NARRA_HOLDER_SECRET=            # HMAC
NARRA_RETENTION_H=168
NARRA_SEMANTIC=on
NARRA_SEMANTIC_NAME=anthropic
```

---

## 12. Operations

- One VPS (4 vCPU, 8 GB, NVMe) in Europe. Docker image, `docker compose` with one service and a volume for `data/`.
- Hourly `sqlite3 .backup` to object storage, kept 7 days.
- Structured JSON logs to stdout.
- `/api/health` returns `503` when the lag exceeds 300 blocks or the last tick is older than 3 minutes. External uptime ping every minute.
- The site must survive a dead backend: see FRONTEND, the `stale` banner.

RPC budget on Chainstack: subscriptions plus a few `eth_getLogs` per minute, one multicall per launch, log queries per chunk for pool attribution. Single-digit millions of calls a month.

---

## 13. Tests

The `narrahood` suite (50 checks, no network) plus service tests: holder gate, rate limits, SSE delay, OG rendering.

---

## 14. Open in the repo, kept by the service

Open (MIT): everything in `narrahood`, the dictionaries, thresholds, formulas.

Not in the repo: our history beyond the local retention, the config with the Chainstack key, Telegram alerts, the dictionary tuned on our history (a base version is published).

---

## 15. Milestones

**Before the token**: deploy `narra serve` on the VPS with 7-day retention, calibrate thresholds after a week of snapshots, API + SSE, the site connects.

**Day 0**: board, coin card, find, OG cards, holder check with an empty contract.

**Day +1…+7**: holder gate, 7-day history, `/flow` and `/wallets` on the site, Telegram alerts, the social-signal module as a fourth signal.
