# narra

**Which meta is printing on Pons v2 / Robinhood Chain right now, and is this token in it?**

A terminal tool. Read-only, zero config, runs on your machine, made for agents as much as for people.

```
$ npx narra-cli now --window 60m

NARRA  11:32:12 UTC   window 60m   pair all   head 61922411   lag 0   publicnode+robinhood · cold

HOT          hood                   81 CA   164.42 ETH 2 grad  4% pool   1834 buyers ← hood-discord
EMERGING     hood-discord           68 CA   76.17 ETH  0 grad  1% pool   786 buyers  → 中国股票指数-csi
EMERGING     尴尬狗-dog             3 CA    15.19 ETH  0 grad  0% pool   85 buyers
EMERGING     cat-icat               13 CA   14.14 ETH  0 grad  0% pool   374 buyers
EMERGING     memfun-mem             2 CA    10.26 ETH  0 grad  0% pool   79 buyers
EMERGING     family-hood            4 CA     7.97 ETH  0 grad  0% pool   49 buyers
…
538/1508 tokens clustered · 681 launches · 44910 trades · 42 sprayer wallets ignored
```

```
$ narra coin 0x2f817ab90dbfd772dfb0c2039ef8f53126441f7b

$icat · iPhone cat · 0x2f817ab90dbfd772dfb0c2039ef8f53126441f7b
phase curve 0.00/4.2 ETH · launched 16m ago · pair ETH

EDGE    cat-icat   0.50   (cluster EMERGING)

reasons
  $icat matches cluster tags icat, cat
  words fit but only 1 early buyer overlaps with the cluster (IN needs 2)
  cluster cat-icat is EMERGING: 13 CA, 14.14 ETH in, 0 graduations in window

sources  launch tx 0xed98…54f7e  block 61908877  early buyers 1  overlap 1
IN means membership in a live meta. It is not a recommendation.
```

Twenty-four thousand tokens launch on Pons every day. People do not lose on the opening tax; they lose by buying into yesterday's meta after the crowd has moved. narra clusters launches into metas by name, shared buyers and shared deployers, measures how much ETH and how many wallets each meta is pulling, follows repeat buyers from one meta to the next, and tells you whether a contract address belongs to a live one — with the numbers behind every sentence.

## Install

Node 22 or newer.

```sh
npx narra-cli now                 # no install
npm i -g narra-cli && narra now   # global
git clone https://github.com/bonsaixbt/narra && cd narra && npm i && npm run now
```

First run reads the last hour from the public RPCs (about two minutes) into `~/.narra/narra.db`. After that every command is incremental and takes seconds. `--window 15m` for a faster first look.

## Commands

| Command | Answers | Exit code |
|---|---|---|
| `narra now [--window 15m\|60m\|4h] [--pair eth\|stable\|stock] [--members] [--top N]` | which metas are HOT / EMERGING / ROTATING / COOLING / DEAD | 0 |
| `narra coin <CA…>` | IN / EDGE / OUT / ORPHAN / NOT_PONS for a token, with reasons | `--quiet`: 0 IN · 1 EDGE · 2 OUT · 3 ORPHAN · 4 NOT_PONS |
| `narra flow` | which wallets and deployers moved from meta A to meta B | 0 |
| `narra why <slug>` | why a cluster is named and grouped that way, members, links | 0 (3 if no such cluster) |
| `narra wallets [--cohort sniper\|sprayer\|rotator\|early-in-hot] [--sort net_eth]` | which wallets carry capital between metas, with cohort labels | 0 |
| `narra wallet <0x…>` | one wallet: cohorts, positions, entry delay after launch, ETH in/out | 0 |
| `narra history <slug\|0x…> [--hours 24]` | status timeline of a meta, or hourly activity of a token | 0 / 3 |
| `narra watch [--every 15] [--only STATUS,EDGE]` | live feed: LAUNCH, STATUS, EDGE, GRAD, JOIN | runs until ctrl-c |
| `narra doctor` | RPC, chain id, live Pons parameters vs expectations, cache | 0 / 11 |
| `narra serve [--port 4663]` | the same answers as JSON over local HTTP + SSE | runs |
| `narra mcp` | MCP server over stdio for Claude, Cursor, Codex and friends | runs |
| `narra schema [now\|coin\|flow\|why\|watch]` | JSON Schema of every output | 0 |
| `narra backfill --hours 24` · `narra cache [path\|stats\|clear]` | deep backfill (raises retention; older rows fold into hourly aggregates) · maintenance | 0 |

Every command takes `--json` (streams take `--jsonl`), `--rpc <url,url#nologs>`, `--db <path>`, `--no-color`, `--offline` (analyse the cache without syncing). Addresses can come from stdin: `echo 0x… | narra coin -`.

## For agents

**MCP.** One line in the MCP config of Claude Desktop, Claude Code, Cursor, Windsurf or Codex:

```json
{ "mcpServers": { "narra": { "command": "npx", "args": ["-y", "narra-cli", "mcp"] } } }
```

```sh
claude mcp add narra -- npx -y narra-cli mcp
```

Tools: `narra_now`, `narra_coin`, `narra_flow`, `narra_why`, `narra_doctor`. A prompt `narra_check_before_entry` tells the model to call `narra_coin` first, quote the reasons and never encourage entries into dead or orphan metas.

**JSON.** Every answer carries `schema_version`, `computed_at`, `window`, `head_block`, `lag_blocks` and `source`. Fields never disappear within a major version. `narra schema coin` prints the JSON Schema.

```sh
narra coin 0x… --json | jq '{verdict, cluster, reasons}'
narra now --json | jq -r '.clusters[] | select(.status=="HOT") | .slug'
narra watch --jsonl --only STATUS | jq -r 'select(.to=="HOT") | .slug'
narra coin 0x… --quiet && echo "in a live meta"
```

**HTTP.** `narra serve` binds `127.0.0.1:4663`: `/now`, `/coin/:ca`, `/flow`, `/why/:slug`, `/stream` (SSE), `/schema/:name`, `/health`. For n8n, Make, Telegram bots, anything with an HTTP node.

**Library.**

```ts
import { createNarra } from "narra-cli";
const narra = createNarra();            // public RPCs, ~/.narra/narra.db
const board = await narra.now();         // same object as `narra now --json`
const card  = await narra.coin("0x…");
narra.close();
```

Pure functions (`tokenize`, `buildClusters`, `statusOf`, `flowEdges`, `verdictFor`) are exported without any network dependency.

Ready-made files for Claude Code skills, Cursor rules, `AGENTS.md`, OpenAI function calling, LangChain and shell pipelines live in [`integrations/`](./integrations).

## How it decides

- **Tags.** Name, ticker and the first sentence of the description become weighted tags through an open dictionary (`src/analyze/dictionary.json`): stop words, aliases (`robinhood → hood`, `tesla → tsla`), compound tickers split on known seeds (`HOODRAT → hood, rat`). Ticker weighs 1.2, name 1.0, description 0.4; the pair asset adds `pair:eth` / `pair:stable` / `pair:stock`.
- **Clusters.** Two tokens are linked when the weighted Jaccard of their tags is ≥ 0.35, or when they share a deployer and a tag. Groups formed that way merge when at least two token pairs across them share a crowd (≥ 5 common buyers and ≥ 20 % of the smaller token's buyers). Wallets that buy more than 8 / 20 / 50 distinct tokens per 15m / 60m / 4h are snipers and do not vote. Components of three or more tokens are metas; the slug is the two heaviest tags.
- **Heat.** Per window: launches, members alive (a buy in the last 15 minutes), ETH into curves and pools, unique buyers, graduations, share of members already in a Uniswap v4 pool, share of buys that paid the opening tax, change against the previous window.
- **Status.** `HOT` ≥ 8 CA, ≥ 1.5 ETH, ≥ 1 graduation · `EMERGING` fewer CA but ≥ +100 % and ≥ 30 buyers · `ROTATING IN/OUT` ≥ 8 repeat wallets arriving / leaving · `COOLING` many CA, little money, falling · `DEAD` nothing alive. Thresholds live in `src/analyze/thresholds.json` with their calibration date.
- **Flow.** A wallet "sat in" meta A if it bought two different A tokens in the previous window; the edge A→B counts those wallets buying B in this window, plus deployers that switched.
- **Verdict.** membership = ½ text similarity to the cluster + ½ share of the token's early buyers seen in other members. `IN` needs ≥ 0.5 and at least two overlapping buyers in a live cluster; `EDGE` is a name that fits without the capital; `OUT` is a cooling or dead cluster, or ≥ 30 % of early buyers already in another meta; `ORPHAN` matches nothing.

Full description with formulas: [docs/STRATEGY.md](./docs/STRATEGY.md). What is read from the chain and how: [docs/PONS.md](./docs/PONS.md). What the tool does not do: [docs/SAFETY.md](./docs/SAFETY.md).

## Semantic layer (optional)

Off by default; the deterministic core never depends on it. `NARRA_SEMANTIC=on` adds two things:

- **Embeddings → semantic links.** Every token's name, ticker and first description sentence are embedded once (cached in SQLite). Two tokens link when their vectors are close in three senses at once: above an absolute floor, ≥ 2.5 standard deviations above each token's mean similarity to everything else (embedding models squeeze unrelated meme names into a narrow band), and mutually in each other's top-3. Default model is `Xenova/multilingual-e5-small` through transformers.js: local, CPU, ~120 MB downloaded once, ~1 500 names in a few seconds. `NARRA_SEMANTIC_EMBED=openai` points at any OpenAI-compatible `/v1/embeddings` instead (OpenAI, Ollama, LM Studio, OpenRouter).
- **Cluster naming.** `NARRA_SEMANTIC_NAME=openai|anthropic` asks a chat model for a label and a one-line summary per published cluster (≤ 30 per tick, cached by member set, capped by `NARRA_SEMANTIC_BUDGET_PER_DAY`). The Anthropic provider uses the official SDK and `claude-opus-5` by default; set `NARRA_SEMANTIC_MODEL=claude-haiku-4-5` for the cheap option. Labels are display only and never influence clustering.

`--no-semantic` produces the same numbers without semantic links; `narra why` shows how many links of each kind hold a cluster, `narra doctor` shows the provider and the embedding cache. Measured on 2026-09-13: with the layer on, a 60 m board gained 192 semantic links next to 1 015 name links, and the first run cost 12 s (model load + 1 559 embeddings), later runs 5 s.

## Wallets

Cohorts are arithmetic over the cache, recomputed every tick: **sniper** (≥ 3 buys, half of them within 5 s of launch), **sprayer** (more distinct tokens than the window's cap; they do not vote in clustering), **rotator** (bought in ≥ 3 metas, net ETH out > in), **early-in-hot** (≥ 3 buys of live-meta members within 5 minutes of launch). Every cluster shows its cohort mix, and a token's verdict says how many rotators and early-in-hot wallets are among its early buyers. Net flow is out − in and ignores what is still held; it is a flow number, not a P&L claim, and there is no follow-this-wallet mode.

## After graduation

A meta does not end when its tokens leave the curve. narra indexes the Uniswap v4 pools Pons creates at graduation (`Initialize` on the PoolManager behind the Pons hook) and every `Swap` in them. Pool buys count toward the meta's ETH and buyers, the card shows `phase pool · graduated 18m ago · 59.61 ETH volume in window`, and `graduated_share` tells you when a meta has matured and late launches into it tend to trail. Wallets behind pool trades come from the token's own `Transfer` events (the PoolManager pays the hook its fee and the rest to the buyer, sometimes through routers), so attribution costs one log query per chunk and no per-transaction reads.

## Your own RPC

Copy `.env.example` to `.env` (project) or `~/.narra/.env` (user) and put a private node first:

```
NARRA_RPC_URL=https://your-node/key,https://rpc.mainnet.chain.robinhood.com
NARRA_WS_URL=wss://your-node/ws/key
```

The file is gitignored and never leaves the machine. `narra doctor` shows which endpoints are in use.

## Numbers (public RPC, 2026-09-13)

| | |
|---|---|
| cold start, 60 m window | ~134 s · 1 508 launches · 44 910 trades |
| cold start, 15 m window | ~35 s |
| incremental sync | 3–10 s |
| `narra coin` from a warm cache | < 2 s |
| chain-wide curve buys | ~8 per second |

## Tests

```sh
npm test        # 35 checks, no network: tokenizer, clustering, thresholds, flow, verdict, log decoding on recorded fixtures
npm run build   # tsc → dist
```

## What it is not

No private key. No `--live`. No buy button. No wallet connect. `IN` means the token belongs to a live meta. It is not a recommendation, and metas die faster than clusters update.

MIT.
