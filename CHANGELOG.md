# Changelog

## Unreleased

- Flow history: every analysis tick stores its edges (`flow_ticks`, `flow_snapshots`); `narra history flow` and `GET /api/history/flow?window&hours&step` return one sampled tick per step (the last inside it, never a sum: consecutive windows overlap and would count the same wallets many times). Ticks that predate the tables are recomputed from stored trades and cluster snapshots on first use; the service does that for the last 24 h at startup.
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
