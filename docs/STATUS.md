# narra — project status

Date: 2026-09-13 (last update: terminal, narratives, popularity, readability; 48 h of history collected)
Version: 0.2.0 (not published to npm; `npm pack` gives a 94 KB tarball, clean install without optional dependencies verified)
Package: `narra-cli`, binary `narra`

---

## How it works

```
chain (Robinhood Chain, Pons v2 factory + every curve + Uniswap v4 PoolManager)
   │  eth_getLogs in 2 000-block chunks, parallel on a private node; websocket wakes live loops
   ▼
ingest   decode → SQLite (~/.narra/narra.db): launches, tokens, pairs, curve_trades, pools, pool_swaps, hourly, cursors, snapshots
   │  one multicall per new token: name, symbol, description, socials, factory record
   ▼
analyze  tokenize (tags from name/ticker/description, CJK dictionary) → cluster (components with a size guard)
         → heat → status → flow (edges A→B by repeat wallets) → wallets (cohorts) → narrative → verdict
   │
   ▼
output   CLI tables · --json/--jsonl from zod schemas · full-screen terminal · MCP over stdio · HTTP on 127.0.0.1 · createNarra()
```

One process, no daemon. Every command syncs the cache first (incrementally, in seconds), then computes. `--offline` computes from the cache without the network.

Rules live in two open files: `src/analyze/dictionary.json` (stop words, aliases, compound seeds, CJK translations, narrative families) and `src/analyze/thresholds.json` (status thresholds, publish filter, sprayer caps).

---

## Done

| Area | What exists | Files |
|---|---|---|
| Chain | constants, ABI, event topics self-checked against known hashes | `src/chain/constants.ts`, `abi.ts`, `topics.ts` |
| RPC gate | endpoint list with `logs` capability, concurrency caps, penalty box on 429 and Cloudflare, no batching, learned block-range cap with automatic splitting | `src/chain/rpc.ts` |
| Store | SQLite WAL, typed rows, window queries, snapshots, hourly aggregates, retention with compaction, WAL checkpoint after prune | `src/store/db.ts`, `schema.ts` |
| Ingest | log decoding, timestamp interpolation per chunk, block-at-time estimation, chunked backfill with a cursor and backward fill for deeper windows, old-curve resolution by curve topic (cached when unresolvable), multicall enrichment, pair symbols, ETH/USD for stable pairs, batched quote normalisation | `src/ingest/*` |
| Pools after graduation | `Initialize` on the PoolManager with the Pons hook → `pools`; `Swap` for known pools → `pool_swaps`; wallet attribution by walking the token's `Transfer` chain from/to the PoolManager, skipping the hook's fee leg; pool volume and buyers count in heat; the card shows `pool` phase and volume | `src/ingest/pools.ts` |
| History | parallel chunks on a private node (6 in flight), `narra backfill --hours N`, retention raised automatically, rows older than retention fold into per-token hourly aggregates, `narra history`, `narra trend`. Measured on Chainstack: 6 h ≈ 232 s, 48 h collected: 39 286 launches, 2.27 M curve trades, 207 k pool swaps, 1.5 GB (~620 MB/day) | `src/ingest/sync.ts`, `src/cli/history.ts`, `trend.ts` |
| Tokenisation | stop words, aliases, plurals, compound tickers (`HOODRAT → hood + rat`), weights ticker 1.2 / name 1.0 / description 0.4 / pair 0.6, CJK runs kept plus dictionary translations (`金狗 → dog`, `罗宾侠 → hood`) | `src/analyze/tokenize.ts`, `dictionary.json` |
| Clustering | links by name (Jaccard ≥ 0.35), deployer + tag (not for launch farms with > 8 launches), wallets (≥ 5 shared and ≥ 20 % of the smaller set; groups merge only with ≥ 2 cross pairs), optional semantic links; sprayers (> 8/20/50 tokens per 15m/60m/4h) do not vote; components above 60 members re-clustered with stricter thresholds; stable slugs across ticks; link kinds counted | `src/analyze/cluster.ts` |
| Heat and status | launches, alive members, ETH in, buyers, graduations, share in pool, share of buys within 5 s of launch, delta vs the previous window; six statuses with priority; publish filter | `heat.ts`, `status.ts`, `thresholds.json` |
| Flow | edges A→B by wallets (≥ 2 tokens of A in the previous window → B now) and deployers; per-cluster inflow/outflow totals | `flow.ts` |
| Wallets | per-window stats from curves and pools: buys/sells, ETH in/out, net, wins, median entry delay, fast-buy share; cohorts sniper / sprayer / rotator / early-in-hot; cohort mix per cluster; cohort reasons in verdicts; `narra wallets`, `narra wallet` | `src/analyze/wallets.ts`, `src/cli/wallets.ts` |
| Narratives | cluster class by dictionary rules: `chinese` at ≥ 50 % CJK names with a sub-narrative, otherwise the strongest tag family (animals, stocks, robinhood, ai-agents, politics, crypto, tools, celebrities, money, culture) or `mixed`; token narratives on the card | `src/analyze/narrative.ts` |
| Verdict | membership = ½ text + ½ early-buyer overlap; IN needs ≥ 0.5 and ≥ 2 overlapping buyers; rotation measured on the last 10 minutes; reasons as sentences with numbers; popularity (meta rank, rank inside, buyer percentile); launch-farm and sniper warnings | `verdict.ts`, `src/narra.ts` |
| Semantic layer (optional, off by default) | local embeddings via transformers.js (`Xenova/multilingual-e5-small`), any OpenAI-compatible `/v1/embeddings` and `/v1/chat/completions`, Anthropic SDK for naming; cached embeddings and labels; semantic links with three gates (absolute floor, z-score ≥ 2.5, mutual top-3); zero-shot categories from taxonomy anchors; label + summary per cluster with a daily budget; `--no-semantic` | `src/semantic/*` |
| Commands | `now`, `coin`, `find`, `why`, `flow`, `wallets`, `wallet`, `watch`, `terminal`, `history`, `trend`, `doctor`, `backfill`, `calibrate`, `schema`, `cache`, `serve`, `mcp` | `src/cli/*` |
| Readability | the board opens with the answer (totals, hottest, draining, narrative shares), top 15 without DEAD, columns adapt to terminal width, right-aligned numbers; `find` and fuzzy `why`; card without duplicates; wallets without old-bag sellers by default | `src/cli/now.ts`, `find.ts`, `terminal.ts` |
| Terminal | full-screen view without a TUI library: board, selected meta (own full-width view), live feed, contract lookup, flow, wallets; the analysis runs in a forked child process so keys never wait; ticks at most every 10 s; verified with expect at 140 and 80 columns | `src/cli/terminal.ts`, `src/cli/worker.ts` |
| Live | websocket subscription to the factory and PoolManager wakes `watch`/`serve` (debounced 5 s), watchdog re-subscribes after 45 s of silence | `src/ingest/live.ts` |
| Reorgs | cursor stores the block hash; on mismatch the 200-block tail is dropped and re-read | `src/ingest/sync.ts` |
| Integrations | MCP (7 tools + a guardrail prompt), local HTTP + SSE, `createNarra()` and pure functions, generated `schemas/*.json`, Claude Code skill, Cursor rule, AGENTS.md snippet, OpenAI tool schemas, LangChain wrapper, n8n, shell recipes, launchd and systemd units | `src/mcp/`, `src/cli/serve.ts`, `src/lib.ts`, `integrations/` |
| Calibration tool | `narra calibrate` reads snapshots, prints quantiles, proposes thresholds for a target HOT share, `--write` stores them with a date | `src/cli/calibrate.ts` |
| Quality | 50 tests without network (fixtures: 600 real blocks of curve logs, 300 of pool swaps, full replay), typecheck, build, CI on Node 22/24 | `test/`, `.github/workflows/ci.yml` |
| Docs | README, GUIDE (user guide), STRATEGY (formulas), PONS (what is read from the chain), SAFETY, ARCHITECTURE, OSS (phase-1 spec), product/ (phase-2 specs) | `README.md`, `docs/` |
| Config | `.env` in the project or `~/.narra/.env`: RPC, WSS, DB, retention, semantic layer | `src/env.ts`, `.env.example` |

---

## Open

### Needs the owner

| Task | Why | Where |
|---|---|---|
| Publish: GitHub and `npm publish narra-cli` | `npx narra-cli` does not work until then | — |
| Run `narra serve` for a few days, then `narra calibrate --window 60m --hours 168 --write` | status thresholds are still opinions (`calibrated_on: null`) | `integrations/launchd/`, `src/cli/calibrate.ts` |
| An Anthropic key or an OpenAI-compatible endpoint in `.env` | model-written meta labels are untested live | `.env.example` |
| Grow the narrative families in `dictionary.json` | about half of the ETH on the trend falls into `mixed` | `src/analyze/dictionary.json` |

### Before publishing

Done: terminal verified at 80 and 140 columns with the analysis in a child process; default retention 24 h for fresh installs (a deep backfill raises it); CHANGELOG; README without placeholder URLs; `npm pack` checked. Remaining: oversized metas on 4h windows (~60 CA after the farm rule) are a calibration question, re-check after `narra calibrate`.

### Later

- Analysis speed: 4h takes ~25 s, 60m ~5 s; clustering dominates and can be made several times faster without changing results.
- 24h / 7d boards on hourly aggregates.
- Alerts: `narra watch --telegram`, "tell me when meta X turns HOT".
- Prices for stock-token pairs (today stock metas rank by buyers only).
- A real reorg has not been observed; the rewind logic is untested live.
- Phase 2, the hosted product: `docs/product/BACKEND.md`, `docs/product/FRONTEND.md`.

---

## Known weaknesses

- Sprayers are filtered by a token-count cap; a crowd of 200 semi-bots can still chain unrelated groups. `narra why` shows how many links of each kind hold a cluster.
- Launch farms with identical names look like a meta. The card flags the deployer; there is no separate "farm" status.
- Trade timestamps are interpolated inside a chunk (±1 s).
- Curves older than 600 000 blocks (~17 h) without a cached launch are not resolved to a token.
- The `hood` tag is almost generic on this chain; the `robinhood` narrative absorbs a lot.

---

## Run it now

```sh
cd ~/Desktop/bonsai
npm run build && npm link
narra terminal
narra now --window 15m
narra coin <CA>
narra find <word>
narra serve --port 4663          # http://127.0.0.1:4663/now
npm test && npm run build && node dist/bin/narra.js doctor
```

MCP for Claude Code: `claude mcp add narra -- narra mcp`.
