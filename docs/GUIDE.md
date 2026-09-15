# narra — user guide

narra answers three questions about Pons v2 on Robinhood Chain: which meta is printing right now, where capital is rotating, and which meta a given token belongs to. Everything is computed on your machine from chain events. Nothing is signed, no key is ever asked for.

`IN` means "this token belongs to a live meta". It is not a recommendation. Metas on this chain die within minutes.

---

## 1. Install and first run

```sh
cd ~/Desktop/bonsai
npm install
npm run build && npm link        # the `narra` command becomes available in any folder
narra doctor                     # node, Pons constants, cache
```

`.env` in the project folder or `~/.narra/.env`:

```
NARRA_RPC_URL=https://your-node/key,https://rpc.mainnet.chain.robinhood.com
NARRA_WS_URL=wss://your-node/ws/key
```

It also works without a private node, on the public RPCs, just slower: the first hour of data takes about two minutes.

The cache lives in `~/.narra/narra.db`. The first run of any command fetches the missing window; after that every command catches up with the chain in seconds.

---

## 2. Full screen: `narra terminal`

```sh
narra terminal                   # 60m window by default
narra terminal --window 15m      # faster and sharper
```

The screen:

```
 NARRA terminal  15:37 UTC  window 60m  ok · head 62064460 · 106 metas   websocket
 ───────────────────────────────────────────────────────────────────────────────────────
 hottest ponsora-cult 231.4 ETH · 1985 buyers   draining fort-sol 225 wallets left
 narratives mixed 52% · animals 22% · chinese 10%   106 metas · 1059 ETH

 #  status        meta                  narrative        CA   ETH in         buyers  flow │ ponsora-cult  ROTATING IN  mixed
› 1 ROTATING IN   ponsora-cult          mixed             7   231.4 ██████    1985  ⇦21   │ 7 CA · 9 members · 9 alive · 231 ETH · 1985 buyers
  2 ROTATING IN   cat-fart              animals          36    93.9 ██░░░░    1005  ⇦51   │ links name 0 · semantic 0 · wallet 10 · deployer 0
  3 ROTATING IN   rat-rotating          animals           4    52.3 █░░░░░     628  ⇦15   │ cohorts snipers 10 · rotators 11 · early-in-hot 7
  …                                                                                        │   0xefe9…52a4 $MATIUM   curve 0.52   7 ovl  26s ago
 ───────────────────────────────────────────────────────────────────────────────────────
 15:37:33 LAUNCH  0x8650…8b44  $FLYNODE  unclustered
 15:37:33 STATUS  suica  EMERGING → HOT  8 CA · 20.6 ETH · 287 buyers
 ↑↓ move · enter open · c contract · f flow · W wallets · w window · r refresh · ? help · q quit
```

- Left: the board, ranked. ROTATING IN and HOT first, then EMERGING, then the cooling ones.
- Right: the selected meta — numbers, what holds it together, wallet wallet clusters, inflow and outflow, members.
- Bottom: the live feed — new launches, status changes, new flow edges, graduations. The socket wakes the refresh seconds after an event.

Keys:

| Key | Action |
|---|---|
| `↑` `↓` or `j` `k` | select a meta |
| `enter` or `l` | open the meta full screen |
| `b` or `esc` | back to the board |
| `c` | paste a contract address → card |
| `f` | capital flow between metas |
| `W` | wallets with wallet clusters |
| `w` | cycle the window 15m → 60m → 4h |
| `r` | refresh now |
| `?` | help |
| `q` | quit |

---

## 3. Check your token

In the full screen: `c`, paste the address, `enter`. In a plain terminal:

```sh
narra coin 0xADDRESS
narra coin 0xADDRESS --window 4h      # wider window, more context
narra coin 0xA 0xB 0xC                # several at once
echo 0xADDRESS | narra coin -         # from stdin
```

The card:

```
$Roblonks · Roblonks · 0xac42…ee8f
phase curve 0.01/4.2 ETH · launched 11m ago · pair ETH

OUT     cat-fart   0.52   (cluster ROTATING IN)
alt     cheese-rotating   0.51
popular meta #2 of 107 on the board · joins it by wallets · 814 buyers, more than 99% of tokens

reasons
  74/100 early buyers also bought $POWER, $cheese in this window
  7 rotators and 71 early-in-hot wallets among its 100 early buyers
  cluster cat-fart is ROTATING IN: 36 CA, 94.02 ETH in, 1 graduations in window
  41% of early buyers already moved to goatsen
watch
  41 of 100 early buyers bought goatsen in the last 10m → rotating out risk
```

How to read it:

| Line | Meaning |
|---|---|
| `phase` | `curve` still on the bonding curve with progress toward 4.2 ETH; `swept` the pause before the pool; `pool` already trading in Uniswap v4 |
| verdict | `IN` in a live meta; `EDGE` the name fits, the capital does not; `OUT` the meta is cooling or its buyers left; `ORPHAN` matches nothing; `NOT_PONS` not a Pons v2 launch |
| the number after the meta | membership 0..1: half text similarity, half overlap of early buyers |
| `alt` | other metas the token is close to |
| `popular` | the meta's rank on the board, the token's rank inside the meta by buyers, the share of tokens in the window it out-buys |
| `reasons` | every line is derived from numbers: wallet overlap, wallet clusters, the meta's state |
| `watch` | risks: early buyers leaving for another meta, snipers, a launch-farm deployer |

Exit codes with `--quiet`, for scripts: 0 IN, 1 EDGE, 2 OUT, 3 ORPHAN, 4 NOT_PONS.

---

## 4. The board: `narra now`

```sh
narra now                        # top 15, DEAD hidden
narra now --window 4h
narra now --all                  # every meta
narra now --top 40
narra now --pair stock           # only metas with stock-token pairs
narra now --members              # with members under each meta
```

The first lines are the answer: how many metas in which statuses, how much ETH and how many buyers, the hottest meta, where capital is draining and into how many metas, narrative shares. The table follows.

Statuses:

| Status | What happened |
|---|---|
| `HOT` | many launches, much ETH, graduations |
| `EMERGING` | few launches yet, but money and buyers are growing |
| `ROTATING IN` | wallets from other metas are buying here |
| `ROTATING OUT` | those same wallets are already buying the neighbours |
| `COOLING` | many launches, little money, falling |
| `DEAD` | names keep printing, no trades |

Columns: `CA` launches in the window, `ETH in` ETH into curves and pools, `grad` graduations, `buyers` unique buyers, `flow` ⇦ wallets that arrived and ⇨ wallets that left, an arrow with the slug they came from or went to.

The narrative next to the slug: `chinese`, `animals`, `stocks`, `robinhood`, `ai-agents`, `politics`, `crypto`, `tools`, `celebrities`, `money`, `culture` or `mixed`. `chinese·animals` means Chinese names with an animal theme.

---

## 5. Find and understand a meta

```sh
narra find cat                   # by word, ticker, name or address prefix
narra find 0x9e02
narra why cat-fart               # exact slug
narra why cheese                 # any word from its name, tags or tickers
```

`why` shows: the meta's numbers, what holds it together (links by name, semantics, wallets, deployer), tags with example tickers, inflow and outflow, members with membership and buyer overlap. If a word matches several metas the command lists them.

---

## 6. Where capital goes

```sh
narra flow                       # edges A → B for the window
narra flow --window 4h
```

An edge means: wallets bought two or more tokens of meta A in the previous window and bought meta B in this one. Next to it, the ETH they brought into B and the deployers that switched metas. Edges publish at 5 or more wallets, or 2 or more deployers.

---

## 7. Wallets

```sh
narra wallets                    # by net ETH, only wallets that bought in the window
narra wallets --cohort rotator
narra wallets --cohort early-in-hot --sort tokens
narra wallets --all              # including wallets that only sold
narra wallet 0xADDRESS           # one wallet: cohorts, positions, entry delay after launch
```

Wallet clusters:

| Wallet cluster | Rule |
|---|---|
| `sniper` | 3+ buys and half of them within 5 seconds of launch |
| `sprayer` | more tokens per window than the cap of 8 / 20 / 50 for 15m / 60m / 4h; does not vote in clustering |
| `rotator` | bought in 3+ metas and net above zero |
| `early-in-hot` | 3+ buys of live-meta members within 5 minutes of launch |

`net` is ETH out minus ETH in over the window. It ignores what the wallet still holds. It is flow, not P&L.

---

## 8. History

```sh
narra trend --hours 48 --step 4  # ETH per step, narrative shares
narra history cat-fart --hours 6 # a meta's statuses from snapshots
narra history 0xADDRESS --hours 24   # a token's hourly activity
narra history flow --hours 24 --step 1h  # who moved where, one sampled tick per hour
narra backfill --hours 72        # fetch more history
```

Raw trades are kept for 24 hours by default (a deeper `backfill` raises it automatically); older rows fold into hourly aggregates, so `trend` and `history` keep working over weeks.

---

## 9. Live feed without the full screen

```sh
narra watch
narra watch --only STATUS,EDGE
narra watch --jsonl | jq -r 'select(.type=="STATUS" and .to=="HOT") | .slug'
```

---

## 10. For agents and scripts

Every command takes `--json`. `narra schema coin` prints the JSON Schema of the answer.

MCP for Claude Code, Claude Desktop, Cursor, Codex:

```sh
claude mcp add narra -- narra mcp
```

Local HTTP on 127.0.0.1:

```sh
narra serve --port 4663
curl localhost:4663/coin/0xADDRESS
curl localhost:4663/now?window=15m
```

---

## 11. Maintenance

```sh
narra doctor                     # node, constants, cache, semantic layer
narra cache stats
narra cache normalize            # recompute ETH values after a deep backfill
narra cache vacuum               # compact the database
narra cache clear                # start from scratch
narra calibrate --window 60m --hours 168 --write   # status thresholds from collected snapshots
```

Snapshots for calibration accumulate only while `narra serve` or `narra watch` is running. For continuous operation there are units in `integrations/launchd/` and `integrations/systemd/`.

The semantic layer is off by default. `NARRA_SEMANTIC=on` in `.env` enables local embeddings; `NARRA_SEMANTIC_NAME=anthropic|openai` adds model-written labels for metas. Details in `.env.example`.

---

## 12. How not to fool yourself

- The 15m window is sharp and noisy, 60m is the default, 4h shows context but large metas merge there.
- A meta with a hundred buyers and one launch is usually a single token with nothing around it. Look at `CA` and `members`.
- `deployer is a launch farm` on the card means the author prints tokens by the dozen. Such a token can join a meta through wallets; it is not a signal.
- Many snipers among the early buyers means a fast exit. It is written in `watch`.
- Status thresholds are starting values, not calibrated. The numbers in `reasons` are exact; the status labels are approximate.
