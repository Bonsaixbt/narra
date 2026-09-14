# narra — spec for the open terminal version (phase 1)

Date: 2026-09-13
What: `narra` — a CLI and library that runs entirely on the user's machine and answers which meta is printing on Pons v2 / Robinhood Chain right now and whether a token belongs to it.
Status: phase-1 spec, implemented in v0.2.0. `docs/STATUS.md` is the source of truth for the current state; `docs/GUIDE.md` is the user guide. Hosting, the site and holder features are phase 2, see `docs/product/`.

---

## 0. Principles

1. **The terminal is the product.** Everything narra can do is available from the shell without a site, an account or a key.
2. **Zero configuration.** `npx narrahood now` works immediately on public RPCs. A private node is an option, not a requirement.
3. **The agent is the first user.** Every command has `--json` with a stable schema, there is an MCP server, a library API and ready-made skill files. A human reads the same output as the model.
4. **Every number opens.** Every verdict in JSON carries the block, the launch transaction, the window, the buyer counts. No magic.
5. **Read-only.** No private key, no `--live`, no auto-buy. `IN` does not mean "buy".
6. **Own code.** Nothing from other repositories. Public facts about the chain are used freely.
7. **Local data.** The cache lives in `~/.narra/`; the user can delete it at any time.

---

## 1. What it does

| Question | Command |
|---|---|
| Which meta is alive right now | `narra now` |
| Is this CA in a meta? Why? | `narra coin <CA>` |
| Where are repeat buyers moving | `narra flow` |
| Why is a cluster named like that | `narra why <slug>` |
| What is happening right now | `narra watch`, `narra terminal` |
| Give an agent access | `narra mcp`, `narra serve` |
| Is everything working | `narra doctor` |

Does not: trade, compute exit liquidity, rank "smart wallets", read X (social signal is a separate later module).

---

## 2. Install and first run

```sh
npx narrahood now              # no install
npm i -g narrahood && narra now
bunx narrahood now
git clone … && npm i && npm run now
```

Requirements: Node ≥ 22. Runtime dependencies: `viem` (ABI and RPC transport), `better-sqlite3` (cache), `@modelcontextprotocol/sdk` (MCP), `zod` (schemas). Optional: `@huggingface/transformers` (local embeddings), `@anthropic-ai/sdk` (cluster naming).

First run without a cache:

```
narra · cold start · fetching last 60m from public RPC
  launches   ████████████ 36 000 blocks   1 261 launches
  trades     ████████████                31 402 buys · 22 118 sells
  ready in 134s · cache ~/.narra/narra.db
```

Measured on the public node: 3 000 blocks (5 min of chain) across three topics read in 6 s. An hour is about two minutes of cold start, then incremental in seconds. `--window 15m` for a quick first look.

---

## 3. Commands

Common flags: `--json`, `--jsonl` (streams), `--window 15m|60m|4h`, `--pair all|eth|stable|stock`, `--rpc <url>`, `--quiet`, `--no-color`, `--db <path>`, `--offline`, `--no-semantic`.

### `narra now`

The answer first (totals, hottest meta, where capital drains, narrative shares), then the top 15 metas with rank, status, narrative, launches, ETH in, graduations, buyers and flow arrows. `--top N`, `--all`, `--members`.

### `narra coin <CA>`

The card: phase, verdict, cluster, membership, popularity, reasons, watch-outs, sources. Accepts several addresses and stdin (`-`). Exit codes with `--quiet`:

| Code | Verdict |
|---|---|
| 0 | `IN` |
| 1 | `EDGE` |
| 2 | `OUT` |
| 3 | `ORPHAN` |
| 4 | `NOT_PONS` |
| 10+ | error (RPC, input) |

### `narra flow`

Edges A→B: wallets, ETH, deployers, statuses of both ends.

### `narra why <meta>`

Tags with weights and example tickers, how the members are linked, current numbers, members. Exact slug or any word from its name, tags or tickers; several matches are listed.

### `narra find <word>`

Search metas and tokens in the window by word, ticker, name or address prefix.

### `narra watch`

Line-by-line feed: `LAUNCH`, `STATUS`, `EDGE`, `GRAD`, `JOIN`, `SYNC`. `--only` filters, `--jsonl` prints one object per line. Woken by the websocket.

### `narra terminal`

Full-screen view: board, selected meta, live feed, contract lookup, flow, wallets.

### `narra wallets`, `narra wallet <address>`

Wallet cohorts (sniper, sprayer, rotator, early-in-hot), positions, entry delay after launch.

### `narra history`, `narra trend`, `narra backfill`

History over the collected cache.

### `narra doctor`

RPC (HTTPS and WSS), chain id, live factory parameters vs expectations, cache state, lag, semantic layer.

### `narra serve [--port 4663]`

Local HTTP on loopback with the same answers as `--json`: `/now`, `/coin/:ca`, `/flow`, `/why/:slug`, `/stream` (SSE), `/health`, `/schema`. Only `127.0.0.1`.

### `narra mcp`

MCP server over stdio. See §6.

### `narra schema [now|coin|flow|why|watch|wallets|wallet]`

Prints the JSON Schema of an answer. The same files are generated into `schemas/` at build time.

### `narra calibrate`, `narra cache`

Maintenance.

---

## 4. JSON format

Every answer carries `schema_version` (semver, breaking changes only with a major), `computed_at`, `window`, `head_block`, `lag_blocks`, `source: { rpc, mode: "cold"|"cache"|"live" }`.

```jsonc
// narra coin 0xabc… --json
{
  "schema_version": "1.0.0",
  "token": "0xabc…", "symbol": "HOODRAT", "name": "HoodRat",
  "phase": "curve",                      // curve | swept | pool | rescued
  "curve": { "real_quote_eth": 1.9, "threshold_eth": 4.2, "progress": 0.45 },
  "pool": null,                          // { graduated_at, volume_eth_window, swaps_window } in the pool phase
  "pair": { "address": "0x0", "symbol": "ETH", "kind": "eth" },
  "launched_at": 1789300000, "deployer": "0x…",
  "verdict": "IN",                       // IN | EDGE | OUT | ORPHAN | NOT_PONS
  "cluster": { "slug": "stock-hood", "status": "HOT", "membership": 0.81 },
  "alternatives": [{ "slug": "astra-hands", "membership": 0.22 }],
  "reasons": ["$HOODRAT matches cluster tags hood", "14/31 early buyers also bought …"],
  "watch": ["6 of 31 early buyers bought astra-hands in the last 10m → rotating out risk"],
  "narratives": ["robinhood", "animals"],
  "popularity": { "cluster_rank": 2, "clusters_total": 107, "rank_in_cluster": 3, "cluster_size": 9, "buyers": 814, "buyers_percentile": 99 },
  "evidence": { "early_buyers": 31, "overlap_buyers": 14, "text_score": 0.9, "wallet_score": 0.72, "launch_tx": "0x…", "launch_block": 61834120 },
  "computed_at": "2026-09-13T12:04:40Z", "window": "60m", "head_block": 61834396, "lag_blocks": 2,
  "source": { "rpc": "publicnode+robinhood", "mode": "cache" }
}
```

`reasons` and `watch` are ready-made English sentences so a model can quote them without paraphrasing. `evidence` holds the raw counts.

Rule: no field disappears between minor versions; new ones are added.

---

## 5. Library API

```ts
import { createNarra } from "narrahood";

const narra = createNarra({ rpc: process.env.RPC_URL, db: "~/.narra/narra.db" });
await narra.sync("60m");                  // incremental catch-up
const board = await narra.now();          // the same object as narra now --json
const card  = await narra.coin("0xabc…");
for await (const ev of narra.watch()) console.log(ev);
narra.close();
```

Pure functions without any network are exported too: `tokenize`, `buildClusters`, `statusOf`, `heatOf`, `flowEdges`, `verdictFor`, `analyze`. ESM + types.

---

## 6. Agent integration

### 6.1 MCP server (`narra mcp`)

| Tool | Input | Output |
|---|---|---|
| `narra_now` | `{ window?, pair?, top?, members? }` | board |
| `narra_coin` | `{ address }` or `{ addresses[] }` | verdict(s) |
| `narra_flow` | `{ window? }` | edges |
| `narra_why` | `{ slug }` | cluster explanation |
| `narra_wallets` | `{ window?, cohort?, sort?, top? }` | wallet cohorts |
| `narra_wallet` | `{ address }` | one wallet |
| `narra_doctor` | — | health |

Prompt `narra_check_before_entry`: "if the user brings a CA, call `narra_coin` first; do not suggest entries into DEAD, OUT or ORPHAN; always quote the reasons".

```jsonc
// Claude Desktop / Claude Code (.mcp.json) / Cursor / Windsurf / Codex
{ "mcpServers": { "narra": { "command": "npx", "args": ["-y", "narrahood", "mcp"] } } }
```

```sh
claude mcp add narra -- npx -y narrahood mcp
```

### 6.2 Skill files in the repo

```
integrations/
  claude/SKILL.md            # Claude Code skill: when to call what, how to read a verdict
  cursor/narra.mdc           # Cursor rule
  AGENTS.md.snippet          # block for any project's AGENTS.md / CLAUDE.md
  openai/tools.json          # function-calling schemas for OpenAI-compatible APIs
  langchain/narra_tool.py    # 30-line tool wrapper calling the CLI with --json
  n8n/README.md              # HTTP node on narra serve
  shell/examples.sh          # jq pipelines
  launchd/, systemd/         # keep narra serve running
```

### 6.3 Shell and pipes

```sh
narra watch --jsonl --only STATUS | jq -r 'select(.to=="HOT") | .slug'
narra coin 0xabc… --quiet && echo "in a live meta"
narra now --json | jq '.clusters[] | select(.status=="HOT") | .slug'
curl -s localhost:4663/coin/0xabc… | jq .verdict
```

---

## 7. Data and chain

Public constants (checked by `narra doctor`):

| | |
|---|---|
| Network | Robinhood Chain, chain id 4663, ~100 ms blocks |
| Default RPC | `wss://robinhood-rpc.publicnode.com` for subscriptions, `https://rpc.mainnet.chain.robinhood.com` for `eth_getLogs`, `https://robinhood-rpc.publicnode.com` for `eth_call` |
| Pons v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Graduation (ETH pairs) | 4.2 ETH, phantom 1.68 ETH; supply 1e9 |

Events: `TokenLaunched`, `LaunchSwept`, `PoolGraduated` on the factory; `CurveBuy`, `CurveSell` by topic without an address (one query covers every curve); `Initialize`, `Swap` on the PoolManager for pools after graduation; token `Transfer` for pool wallet attribution.

Own RPC layer: endpoint list with `logs` / `ws` flags, no batch requests, concurrency 2 on public nodes and 6 on private ones, a pause on 429, a bench on a Cloudflare challenge, a learned block-range cap with automatic splitting. `--rpc` or `NARRA_RPC_URL` replace everything with one private node.

Cache: SQLite at `~/.narra/narra.db`: `launches`, `tokens`, `pairs`, `curve_trades`, `pools`, `pool_swaps`, `hourly`, `cursors`, `cluster_snapshots`, `embeddings`, `cluster_labels`, `kv`. Raw-trade retention 48 h by default (`NARRA_RETENTION_H`, raised automatically by a deeper backfill); cluster snapshots and hourly aggregates are kept indefinitely.

Quote normalisation: ETH as is; stables through ETH/USD from a public price endpoint (5-minute cache, `stale` when unavailable); stock-token pairs without a price are counted by buyers and launches, not by volume. JSON always carries both the raw and the normalised value.

---

## 8. Algorithms (short; full description in `docs/STRATEGY.md`)

**Tokenisation.** Name, ticker, description → tags. Lowercase, camelCase split, stop words, aliases (`robinhood → hood`), compound tickers split on seeds, CJK runs plus dictionary translations, pair tag `pair:eth`. Weights: ticker 1.2, name 1.0, description 0.4. The dictionary is open in `dictionary.json`.

**Clusters.** Candidates: launches in the window plus any token traded in the window (curve or pool). Two tokens link on weighted Jaccard ≥ 0.35, or on a shared deployer plus a shared tag (not for launch farms with more than 8 launches), or on ≥ 5 shared buyers that are ≥ 20 % of the smaller buyer set (name-groups merge only with ≥ 2 cross pairs), or on a semantic link when the layer is on. Sprayers do not vote. Components of ≥ 3 → cluster; components above 60 members are re-clustered with stricter thresholds. Slug from the two heaviest tags, inherited between ticks at ≥ 50 % member overlap.

**Heat.** Per window: launches, alive members (a trade in the last 15 min), ETH in (curves + pools), unique buyers (`recipient` on curves ∪ the attributed wallet in pools), graduations, share of buys within 5 s of launch, share of members in a pool, delta vs the previous window.

**Status.** `HOT`, `EMERGING`, `ROTATING IN`, `ROTATING OUT`, `COOLING`, `DEAD`. Thresholds in `thresholds.json` with a calibration date. Priority: `DEAD > ROTATING OUT > ROTATING IN > HOT > EMERGING > COOLING`.

**Flow.** A wallet is "in cluster A" if it bought ≥ 2 A tokens in the window. Edge A→B: such wallets buying B in the next window, plus deployers that switched. Published at ≥ 5 wallets or ≥ 2 deployers.

**Verdict.** `membership = ½·text + ½·wallet_overlap` against the best live cluster. `IN ≥ 0.5` with ≥ 2 overlapping early buyers in a live status; `EDGE 0.25–0.5` or no capital; `OUT` when the cluster cools or ≥ 30 % of early buyers moved elsewhere in the last 10 minutes; `ORPHAN` otherwise.

**After graduation.** The pool is found by `Initialize` with the token and pair as currencies and the Pons hook. Swaps are written by `pool_id`; the wallet is the end of the token's `Transfer` chain from the PoolManager (buys) or to it (sells), skipping the hook's fee leg. The token stays in its cluster while it trades. `graduated_share` feeds the verdict as a reason for late launches.

---

## 9. Repository

```
narra/
  README.md                 # sixty seconds to the first output, MCP config, JSON example
  LICENSE                   # MIT
  package.json              # bin: narra
  bin/narra.ts
  src/
    chain/       constants · abi · topics · rpc · multicall
    ingest/      decode · blocks · sync · enrich · pools · live
    store/       schema · db
    analyze/     tokenize · dictionary.json · cluster · heat · thresholds.json · status · flow · wallets · narrative · verdict · board
    semantic/    provider · local · openai · anthropic · taxonomy · index
    cli/         args · render · now · coin · find · why · flow · wallets · watch · terminal · history · trend · doctor · backfill · calibrate · serve · schema · cache
    mcp/         server
    schemas.ts · narra.ts · lib.ts · env.ts
  schemas/       generated JSON Schemas
  integrations/  claude · cursor · openai · langchain · n8n · shell · launchd · systemd · AGENTS.md.snippet
  docs/          GUIDE · STATUS · STRATEGY · PONS · SAFETY · ARCHITECTURE · OSS · product/
  test/          fixtures/ (recorded logs) · *.test.ts
  .github/workflows/ci.yml
```

`docs/SAFETY.md`: what the tool does not do (sign, hold a key, advise entries); what leaves the machine (JSON-RPC to the chosen node, one price request, optional model calls when the semantic layer is on).

---

## 10. Quality

- TypeScript strict, ESM, `node:test`. Tests never touch the network: tokenisation on real names, clustering on synthetic sets with slug stability, status table, flow, verdict, wallets, semantic layer with a fake provider, log decoding on recorded fixtures, a full replay.
- CI: typecheck, test, build on Node 22 and 24.
- Performance: cold start 60m on public RPC ≈ 134 s; `narra coin` from a warm cache ≤ 2 s; `narra now` ≈ 5 s on 60m and ≈ 25 s on 4h; `watch` ticks every few seconds on the websocket.
- Platforms: macOS, Linux, Windows (Windows Terminal; colours and links degrade cleanly).
- Versioning: `0.2.0`; `schema_version 1.0.0` frozen.

---

## 11. Phases

**v0.1 — public repo**: RPC layer, ingest, cache, tokenisation, clusters, statuses, verdicts, flow, watch, MCP, serve, integrations, README. Done.

**v0.2 — before the token launch**: pools after graduation, deep history with hourly compaction, wallet cohorts, semantic layer, websocket trigger, reorg rewind, calibration tool, replay fixtures, CI, terminal, narratives, popularity. Done except the calibration itself (needs days of snapshots) and publishing.

**v0.3 — after the launch**: Telegram alerts, the social-signal module (NOISE) as a fourth signal, a dictionary tuned on history.

**Phase 2 (the hosted product)** — `docs/product/BACKEND.md` and `docs/product/FRONTEND.md`: the same package hosted as a service, history beyond 48 h, a site, a holder gate. The product imports `narrahood` as a dependency; it does not fork it.

---

## 12. Open questions

1. Public RPC bursts: if the cold start exceeds two minutes at peak hours, default the first run to `--window 15m` and fetch the rest in the background.
2. Whether `--window 4h` belongs in the OSS build or only in phase 2: it stays, it costs nothing locally.
3. The description as a tag source may add noise; calibration decides.
