# narra — roadmap

Where the product is on 2026-09-13 and where it goes. Dates are targets, not promises; every item lists who owns it.

## 0. Now: launch prep (next 7 days)

| Item | Owner | Status |
|---|---|---|
| History collection on a server (`narra backfill --hours 168`, `narra serve` running) | owner | starts tomorrow |
| Deploy `service/` on a VPS behind Caddy, seed it with the collected cache | owner + Claude (docs, fixes) | `service/deploy/VPS.md` ready |
| Calibrate status thresholds from a week of snapshots, commit `thresholds.json` | Claude, after the data | tool ready |
| Grow the narrative dictionary (`narra dictionary suggest`, review, `--write`) | owner reviews, Claude runs | first pass done |
| `npm publish narra-cli` so `npx narra-cli` works | owner | package verified |
| Telegram: bot token, community chat id, alert chat id into `service/.env` | owner | bot + alerts built |
| Site on Cloudflare Pages against the live API | frontend dev | brief delivered |
| Launch content: three frames (board, card, flow) recorded from `narra terminal` | owner | — |
| Token launch on Pons v2 | owner | — |

## 1. Launch week

| Item | Owner |
|---|---|
| Site: board, card, search, holder page, OG previews | frontend dev |
| Community bot digest every 30 min + alerts on HOT / ROTATING | owner enables |
| Daily ship posts from real terminal output: one meta rotation per video | owner |
| Watch `/api/health`, backups, first calibration re-run after launch traffic | Claude + owner |

## 2. Month 1: the post-launch backlog

| Feature | What it gives | Where |
|---|---|---|
| Holder mode (postponed on 2026-09-14) | `15m`/`4h`, flow, wallets, history and the undelayed stream for `$NARRA` holders; a pasted public address and a balance read, no signature. The gate is built and dormant in the service; turning it on is config plus the `/holders` page on the site | service + site |
| Personal watchlist (per holder address) | follow metas and tokens; status changes reach the user in the stream and Telegram | service + site |
| Frozen snapshots (`/api/snapshot/:id`) | a post links to the board as it was, not as it is | service + site |
| Home summary in one call (`/api/summary`) | first paint from one request | service + site |
| Per-holder Telegram subscriptions | the bot checks an address and subscribes the user to their watchlist | service |
| PNG share cards on the site | X previews without the SVG detour | site |
| 24h and 7d boards on hourly aggregates | "what happened today" without re-reading 2 M trades | engine |
| Clustering speed | 4h in ~5 s instead of ~25 s; same results | engine |

## 3. Quarter: the product edge

| Feature | Why |
|---|---|
| Social signal as a fourth input (X mentions vs on-chain): `SOCIAL ONLY` / `CHAIN ONLY` / `BOTH` on the card | the one slot where the account's own reach strengthens the tool |
| Stock-token pair pricing | stock metas ranked by ETH, not just buyers |
| Deployer profiles | farms, serial graduates, fee routing — the "who is behind this" line on the card |
| Cohort backtests | what happened to tokens that were `IN` a HOT meta at +15 / +60 min; published as honest numbers, not promises |
| Calibration as a service | thresholds re-fit weekly from the live snapshots, versioned |
| Cross-chain | the engine is chain-agnostic above `src/chain/`; a second launchpad is a second constants file and ingest adapter |

## 4. Principles that do not move

- Read-only. No key, no `--live`, no buy button, no wallet connect.
- Every number opens to its source. Reasons are sentences built from data, never model prose that overrides numbers.
- `IN` is membership in a live meta, not a recommendation, on every surface: terminal, site, bot, MCP.
- The open terminal is the product; the service adds hosting, history and convenience, never exclusive data.
