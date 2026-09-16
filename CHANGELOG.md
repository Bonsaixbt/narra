# Changelog

## Unreleased

- Slug inheritance: the previous cluster that contributes the most members keeps the name; scoring by share alone let a small cluster swallowed by a big one rename the big one, and the name flipped every tick (`star-programmable` ↔ `rarefriend-rare-2` on 2026-09-16 at the meta's HOT minute, so the history showed 59 members one tick and 4 the next).
- A token holding half of a meta's crowd puts its word first in the slug, even over an inherited name: LITVM with 4,600 of 7,000 buyers is `litvm-…`, not `rarefriend-rare-2`. The meta keeps its id, so history by id is unbroken; the previous slug is on `ClusterOut` as the continuation.
- After a strict split of an oversized component, a token that fell out of every sub-cluster rejoins the biggest one whose slug carries its word (the most-bought $penis is back with the other 60; frontend note 11).
- Telegram bot rebuilt on the pattern of scanner bots: one fact per line with an emoji, the address in a code block, inline buttons (card, meta, flow, explorer) under every answer; a pasted CA anywhere in a short message answers with the card; new `/hot`, `/history meta`, `/wallet 0x…`, `/stats`; `/alerts on|off` per chat (admins only in groups, stored in the cache); the command menu is registered with Telegram. Digest at most once an hour and only when the board changed. Alerts only when a meta went HOT or 15+ wallets moved, HOT ↔ ROTATING IN flapping and rotating-out ignored, graduations alone wait for the next real event.
- Flow: edges are kept even when one end is below the publish floor (a meta that emptied out is where the wallets came from); those ends appear as quiet nodes in `/api/flow` (`nodes`) and in flow history, so every edge has a node again. `cluster_snapshots` gets a `(window, ts)` index: `/api/history/flow` over 24 h went from 5 s to well under a second.
- Library exports `WalletsOut`, `WalletOut`, `WalletClustersOut`, `FlowHistoryOut` types.

## 0.3.1 — 2026-09-16

- Fix: a token described as "16x Constructors' champions" crashed the trend every pass (`tag.startsWith is not a function`): the alias table was a plain object and `constructor` returned a function. The table is a Map; regression test.
- `/api/wallet-clusters`: every wallet cluster from one analysis — counts, ETH in/out, medians, overlaps, top metas, members — with a reading that names no address (the site's map needed four consistent calls).
- Flow edges connect published metas only; members carry `buyers` and `eth_in` for the window; the board reading counts every live status and says which; a history reading says "stayed X" when nothing changed; cluster history by id falls back to the slug in another window and `meta_id` is indexed; `dictionary.json → slug_stop` keeps slurs out of slugs and labels; engine sentences say "meta" instead of "cluster"; the trend ignores hourly rollups for hours that raw trades still cover; `curve.real_quote_eth`/`threshold_eth` documented as the pair's quote asset.
- RPC quota: curves that trade inside the window but were launched before the cache began are resolved by reading `token()`/`launchedAt()` on the curve and `getLaunchedToken` on the factory (two multicalls per hundred curves) instead of walking 600k blocks of factory logs backwards — that walk was about a hundred `eth_getLogs` per tick, most of the burn.
- RPC quota: the live trigger no longer subscribes to the PoolManager (every swap, liquidity change and donate was one WebSocket message, hundreds of thousands a day; the polling tick catches swaps anyway) — only factory logs wake the loop. Metadata enrichment sends 100 tokens per multicall instead of 25, pool Transfer queries carry 150 addresses instead of 60. Enrichment multicalls go out unsplit (`batchSize: 0`; viem's default cut a 100-token aggregate into dozens of 1 KB eth_calls — the bulk of the burn, ~100 calls a tick). Health reports the fast worker's gate counters (`rpc.calls`, per endpoint) and the trigger's `events`/`wakes`, so the quota burn is measurable.
- service: PNG share cards rendered blank in the Docker image (no system font for resvg); the runtime image installs DejaVu and the cards name it. The site's `og:image` points at these PNGs, so X previews were black.
- Cluster history (`narra history <slug>`, `/api/history/cluster/:slug`) answers for one window (`--window` / `?window=`, 60m by default) instead of mixing 15m, 60m and 4h snapshots of the same minute, which made statuses flap row to row; it accepts a meta id (`slug@first_seen_ts`) and every row carries the id.
- Narratives: semantic categories vote for the dictionary family they mean (`cat:stock` → stocks, `cat:finance` → money, …) instead of under their own names, so both signals add up; the vote floor is 0.25 (a third of live metas sat at "mixed" with a leader at 0.27); platform memes (fly, send, valhalla, family, pons) join the robinhood family.
- Meta identity: a slug that regenerates from its tags keeps its id when it shares at least one member with the previous tick, not only on the 50% inheritance — ids were reborn every tick and burned the naming budget on metas that died within a minute. Model names go to metas that lived five minutes in the top 25.
- Dictionary review on a week of launches: 64 words that carried the most ETH outside any family were sorted into families (humanist / superintelligence memes → ai-agents, treasury-strategy and insider tickers → stocks, Vlad Tenev and Robinhood tooling → robinhood, and so on) plus seven CJK names; the free models were overloaded, so the sorting was done by hand from `narra dictionary suggest`'s candidate list.
- Model naming of metas: cached by the meta's stable id instead of its member set (which changed every tick and burned the daily budget in two passes: 69 names in two days, none on the live board); the model is asked only for live metas with five or more members, at most three per pass; the service budget is 300 calls a day.
- Status thresholds calibrated on the server's snapshots (160k snapshots, 2036 ticks, 2501 clusters over the 60m window): HOT is the top decile of ETH inflow (≥20 ETH, ≥9 launches) and no longer requires a graduation, which lagged the money and kept HOT at 1% of published metas; EMERGING needs 38 buyers, COOLING starts at 3 launches under 0.25 ETH, publication from 8 buyers. `calibrated_on` is set.

## 0.3.0 — 2026-09-14

- store: the SQLite busy timeout is 30 s (was the 5 s default); on the server three processes write to one file and the fast worker hit `database is locked` while the slow one saved a 4h pass.
- service: metas and coins in Telegram alerts and bot replies link into the site (`NARRA_SITE_URL`, default `NARRA_API_ORIGIN`).
- service: Telegram alerts are one digest per `NARRA_TG_ALERT_BATCH_S` (5 min) — metas that turned HOT or started rotating, the biggest moves (≥10 wallets), graduations — instead of one message per event; nothing is sent during the first 90 s after a start, when the first tick replays every status; a 429 keeps the batch and retries after Telegram's pause.
- Flow history: every analysis tick stores its edges (`flow_ticks`, `flow_snapshots`); `narra history flow` and `GET /api/history/flow?window&hours&step` return one sampled tick per step (the last inside it, never a sum: consecutive windows overlap and would count the same wallets many times). Ticks that predate the tables are recomputed from stored trades and cluster snapshots on first use; the service does that for the last 24 h at startup.
- Flow edges carry `moves`: for every counted wallet, its earliest buy into the destination inside the window (`wallet, token, symbol, ts, eth, tx`), so a rotation can be traced to transactions. Flow history slots say `flow_known: false` for ticks whose edges were never computed.
- Stable meta identity: clusters carry `id` (`slug@first_seen_ts`) and `first_seen_ts` on the board, the cluster card, flow nodes and flow history. The id follows the slug while it is inherited between ticks (shared members) and changes when a slug returns with different members. Stored in `cluster_snapshots.meta_id/first_seen` through an in-place migration.
- `trend`: the hourly aggregate forces the `ts` indexes; the planner used to walk `(token, ts)` in token order and touch the whole trade table through random pages (65 s on 2.4M rows, now ~7 s). Token history reads a token's pool swaps by index instead of scanning a day of swaps (0.9 s → 2 ms).
- service: `/api/trend` is precomputed in the engine worker every `NARRA_TREND_EVERY_S` (900 s) and served from cache; it used to run on the request and block every other route (and the site's 8 s fetches) for as long as it took. Non-default spans answer `BAD_TREND`.
- service: the engine runs two children — fast (sync, 60m, 15m every tick) and slow (4h, trend) — so a 200 s 4h pass no longer ages the 60m analysis past `NARRA_STALE_AFTER_S` and flips health to 503 every 15 minutes; a restart is healthy after the first fast tick instead of after the first 4h pass.
- `now --members` (the site's hero call, `/api/board?members=1`): the last-trade map is built once per call instead of once per cluster (77 clusters × every trade in the window; 3.5 s → well under a second on the server).
- service: health reports the last Telegram refusal for the bot and the alerter (`last_error`) and how long ago the bot's `getUpdates` last succeeded (`poll_age_s`), so a silent bot is diagnosable from outside.
- service: `/api/health` refreshes the table counts once a minute instead of running `COUNT(*)` over three million trades on every call (the site asks for health on every home render).

## 0.2.0 — 2026-09-13

First public version.

- Board (`now`) with a summary block, ranks, narratives, flow arrows; `find`, fuzzy `why`.
- Verdict card (`coin`) with membership, popularity, reasons, watch-outs, exit codes.
- Full-screen `terminal` with live feed and contract lookup; analysis in a child process so the screen never freezes.
- Pools after graduation: Uniswap v4 `Initialize`/`Swap` with wallet attribution through token transfers.
- History: parallel backfill, backward fill, hourly compaction, `history`, `trend`.
- Wallet cohorts (`wallets`, `wallet`): sniper, sprayer, rotator, early-in-hot.
- Narrative classes from an open dictionary; CJK translations; launch-farm rule.
- Optional semantic layer: local embeddings, OpenAI-compatible or Anthropic naming, taxonomy categories.
- WebSocket wake-up for `watch` and `serve`; reorg rewind; `calibrate`; generated JSON schemas.
- MCP server (7 tools + guardrail prompt), local HTTP + SSE, library API, integration files.
