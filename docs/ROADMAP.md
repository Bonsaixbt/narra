# narra — roadmap, six months from 2026-09-15

Where the product is today and where it goes through March 2027. Dates are targets, not promises; every line names an owner: **owner** (Bonsai), **Claude** (engine, service, ops), **frontend** (Alexej). Items move between months; the principles at the end do not.

## 0. Where we are on 2026-09-15

Done and live:

- Engine: clustering, heat, statuses, flow, wallet clusters, narratives, verdicts, readings. Thresholds calibrated on a week of snapshots (2026-09-14). Dictionary reviewed on a week of launches; semantic categories and the dictionary vote together; "mixed" fell from 54% to ~25% of live metas. Model names for metas, cached by a stable meta id.
- Terminal `narra` (package `narrahood`, publish pending), library, MCP server, JSON Schemas, agent integrations.
- Service on GCP behind `api.narrahood.com` (Cloudflare Tunnel): fast and slow workers, precomputed trend, flow history with sampled ticks, per-edge moves, OG cards, SSE + polling, health with RPC meter. RPC burn cut from ~113 to ~18 calls a tick.
- Site on Cloudflare Workers at `narrahood.com`, auto-deployed from the `site` branch.
- Telegram: community bot (digest + commands) and batched alerts, both linking into the site.
- 30 days of trade retention; hourly aggregates beyond that.

Open on the owner's side: `npm publish` (2FA), token contract and launch date, holder mode switch after launch.

## 1. Launch week (2026-09-15 → 09-21)

| Item | Owner | Done when |
|---|---|---|
| `npm publish narrahood` | owner | `npm i -g narrahood && narra` works on a clean machine |
| Site: `/flow` with history and moves, `/wallets` as wallet-cluster cards with copyable addresses, streaming home | frontend | pages ship against the live API; home TTFB < 0.5 s |
| Content warm-up starts (the owner's content plan, kept outside the repo) | owner | first ship post with a real board |
| Token launch on Pons v2 | owner | address in `service/.env` as `NARRA_TOKEN_ADDRESS` (gate stays off) |
| Watch: health, RPC meter, memory, backups; calibration re-run on launch-week traffic | Claude | daily check, one summary to the owner |
| Preview cards checked on real X posts | owner + frontend | cluster and coin cards render in X previews |

## 2. Month 1 (→ 2026-10-15): holders and speed

| Feature | What it gives | Owner |
|---|---|---|
| Holder mode on (a few days after launch) | `15m`/`4h`, flow, wallets, history and the undelayed stream for `$NARRA` holders; pasted address, balance read on chain, HMAC cookie — code is built and dormant | owner flips `NARRA_HOLDER_SECRET`; frontend ships `/holders` |
| Home summary in one call (`/api/summary`) | first paint from one request: hottest, draining, narratives, top 5, latest events | Claude, frontend |
| Personal watchlist per holder address | follow metas and tokens; status changes reach the user in the stream and Telegram | Claude, frontend |
| Frozen snapshots (`/api/snapshot/:id`) | a post links to the board as it was, not as it is | Claude, frontend |
| PNG share cards on the site | X previews without the SVG detour | frontend |
| Token classification beyond the ticker (AI agents first) | classify each token once from name + description + website/twitter with a batched model call, cached per token, plus deployer families; `cat:` tags with confidence feed the narrative vote | Claude |
| Clustering speed | 4h pass from ~4 min to under a minute on the current VM (incremental candidate sets, cached tag similarity); frees the slow worker for daily boards | Claude |
| RPC budget guard | health warns when the projected monthly burn crosses the plan; getBlockByNumber interpolation trims the last 30% | Claude |
| Weekly calibration re-fit, versioned | `thresholds.json` re-fit from live snapshots every Monday, change logged | Claude |

## 3. Month 2 (→ 2026-11-15): time and people

| Feature | What it gives | Owner |
|---|---|---|
| 24h and 7d boards on hourly aggregates | "what happened today / this week" without re-reading millions of trades; the `1d` toggle the site asked for | Claude, frontend |
| Deployer profiles | farms, serial graduates, fee routing; the "who is behind this" line on the coin card and a `/deployer/:address` page | Claude, frontend |
| Wallet-cluster backtests, published | what happened to tokens that were `IN` a HOT meta at +15 / +60 min, as honest numbers on a `/stats` page | Claude, frontend |
| Per-holder Telegram subscriptions | the bot checks an address and subscribes the user to their watchlist | Claude |
| Ops: bigger VM if ticks exceed 30 s, Workers Builds with preview URLs | e2-standard-4; PR previews for the frontend | owner, frontend |

## 4. Month 3 (→ 2026-12-15): the edge

| Feature | What it gives | Owner |
|---|---|---|
| Social signal as a fourth input | X mentions vs on-chain: `SOCIAL ONLY` / `CHAIN ONLY` / `BOTH` on the card; the one slot where the account's own reach strengthens the product | Claude (ingest), owner (X API access) |
| Stock-token pair pricing | stock metas ranked by ETH, not only buyers | Claude |
| API keys for holders | a key per holder address for scripts and agents, same limits as the cookie | Claude |
| MCP and agent integrations pushed | `narra mcp` in Claude Desktop / Cursor recipes, showcased; `narrahood` in agent tool registries | owner (content), Claude (docs) |
| Calibration as a service | thresholds re-fit and published as data: how HOT is defined this week and why | Claude |

## 5. Months 4–6 (2026-12-15 → 2027-03-15): beyond one launchpad

| Feature | What it gives | Owner |
|---|---|---|
| Second launchpad / chain | the engine is chain-agnostic above `src/chain/`; a second adapter proves it and doubles the audience | Claude |
| Cross-launchpad metas | the same wave seen on two chains, one board | Claude |
| Store on Postgres when a second writer is needed | the store layer is the only place that knows SQLite | Claude |
| Embedding-first clustering option | local embeddings as a first-class link, not only a tie-breaker; evaluated against the current clusters on replay fixtures | Claude |
| Self-serve alert rules | per holder: "tell me when a meta with word X turns HOT", in Telegram and the stream | Claude, frontend |
| v1.0 of the terminal | frozen CLI contract, JSON Schemas versioned 1.x, changelog discipline | Claude, owner |

## 6. The public roadmap, mapped

`ROADMAP-PUBLIC.md` is the version for the site and the announcement (no dates, no owners). Every public line lives here with a month:

| Public line | Here | When |
|---|---|---|
| Extended access for holders | Holder mode on | month 1 |
| One-call summary and an instant home page | `/api/summary`, streaming home | month 1 |
| Alerts and a watchlist | Personal watchlist; per-holder Telegram subscriptions | months 1–2 |
| Frozen snapshots | `/api/snapshot/:id` | month 1 |
| Share images | PNG share cards on the site | month 1 |
| Sharper narratives | Token classification beyond the ticker | month 1 |
| Published calibration | Weekly re-fit, versioned; calibration as a service | months 1, 3 |
| 24h and 7-day boards | Boards on hourly aggregates | month 2 |
| Deployer profiles | Deployer profiles | month 2 |
| Public track record | Wallet-cluster backtests, published | month 2 |
| Social signal | Social signal as a fourth input | month 3 |
| Stock-token metas | Stock-token pair pricing | month 3 |
| API keys | API keys for holders | month 3 |
| Your own alert rules | Self-serve alert rules | months 4–6 |
| More launchpads | Second launchpad, cross-launchpad metas | months 4–6 |
| Terminal 1.0 | v1.0 of the terminal | months 4–6 |

Not on the public page because nobody outside needs them: clustering speed, the RPC budget guard, Postgres, embedding-first clustering, MCP recipes (content, not a feature).

## 7. Standing work every month

- Dictionary review from `narra dictionary suggest` on the previous month's launches.
- Calibration re-fit and a one-paragraph note in the changelog.
- RPC and disk meters read; backups restored once to prove they restore.
- Dependencies bumped; tests green on Node 22 LTS and current.

## 8. Principles that do not move

- Read-only. No key, no `--live`, no buy button, no wallet connect.
- Every number opens to its source. Reasons are sentences built from data, never model prose that overrides numbers.
- `IN` is membership in a live meta, not a recommendation, on every surface: terminal, site, bot, MCP.
- The open terminal is the product; the service adds hosting, history and convenience, never exclusive data.
- Holder features are speed and depth, never different truth.
