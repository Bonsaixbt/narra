# narra — frontend handoff

For the person building the site. Everything you need to start today is in this file; the two longer specs (`FRONTEND.md`, `BACKEND.md`) sit next to it for detail.

## 1. What narra is, in one paragraph

Pons v2 is a memecoin launchpad on Robinhood Chain: about 30 000 tokens launch every day. narra groups those launches into **metas** (waves of similarly named tokens bought by the same crowd), measures which metas are pulling ETH and buyers right now, follows wallets from one meta to the next, and tells you whether a given contract address belongs to a live meta. It is a read-only analytics tool: no wallet, no trading, no private keys anywhere. The verdict `IN` means "belongs to a live meta" and is never a buy signal — the site must keep that framing.

The engine exists and runs as a terminal tool (`narra-cli`, TypeScript, MIT). The site is a thin, fast, good-looking window on the same data.

## 2. What you get from the backend

The backend is `service/` in the same repository: the narra engine behind HTTP + SSE (Hono). **Run the real backend on your laptop today** — no mocks:

```sh
git clone https://github.com/Bonsaixbt/narra && cd narra
npm install && npm run build
cd service && cp .env.example .env && npm install && npm run dev
# first tick fetches the last hours from public RPCs (a few minutes), then it stays live
curl localhost:4663/api/health
curl "localhost:4663/api/board?top=5" | jq '.clusters[] | {slug, status, narrative}'
```

Every response is validated against zod schemas; the JSON Schemas are checked into `schemas/*.json` (`now`, `coin`, `flow`, `why`, `watch`, `wallets`, `wallet`). Types come from the package: `import type { NowOut, CoinOut, FlowOut, WhyOut, WalletsOut, WalletOut, WatchEvent } from "narra-cli"`.

### Endpoints (all under `/api`)

| Method | Path | Returns | Gate |
|---|---|---|---|
| GET | `/health` | `{ ok, snapshot_age_s, head_block, lag_blocks, ticks, last_error, … }` — `503` when stale | no |
| GET | `/board?window=60m&top=15&all=1&members=1&pair=all\|eth\|stable\|stock` | `NowOut` | `15m` and `4h` windows: holders |
| GET | `/coin/:ca?window=60m` | `CoinOut` or `NotPonsOut` | no |
| GET | `/find?q=word` | `{ clusters: [{slug,status,narrative,rank,eth,buyers,why}], tokens: [{token,symbol,name,cluster,status,buyers,launched_at,phase}] }` | no |
| GET | `/cluster/:slug?window=60m` | `WhyOut` (slug, or any word from its name/tags/tickers; `400 AMBIGUOUS` lists the matches) | no |
| GET | `/flow?window=60m` | `FlowOut` — every edge also carries `moves: [{ wallet, token, symbol, ts, eth, tx }]`, one per counted wallet: its earliest buy into `to` inside the window, oldest first (the transaction to link) | holders |
| GET | `/wallets?cohort=rotator&sort=net_eth&top=25` | `WalletsOut` | holders |
| GET | `/wallet/:address` | `WalletOut` | holders |
| GET | `/history/cluster/:slug?hours=24` | `{ slug, hours, snapshots: [{ts, status, n_launches, quote_eth, buyers, graduations, members}] }` | holders |
| GET | `/history/token/:ca?hours=24` | `{ token, hours, rows: [{hour, curve_buys, curve_in_eth, pool_buys, pool_in_eth, buyers}] }` | holders |
| GET | `/history/flow?window=60m&hours=24&step=1h` | `{ window, hours, step, step_s, since, until, slots: [{ ts, from_ts, nodes: [{slug, status, id, first_seen_ts}], edges: [{from, to, wallets, eth, deployers}] }], reading }` — one sampled tick per step (the last inside it), never a sum, because consecutive windows overlap; slots sit on the wall-clock grid of the step (hour marks for `1h`), the last slot is the running one, and a finished slot samples the same tick on every call; `ts: null` for a step without a tick; `flow_known: false` when the tick predates the flow tables and the worker has not recomputed it yet (edges unknown, not empty; the service backfills two days after each start); `step` 15m \| 1h \| 4h | holders |

**Meta identity.** Every cluster carries `id` (`slug@first_seen_ts`) and `first_seen_ts` on `/board`, `/cluster/:slug`, `/flow` nodes and `/history/flow` nodes. A slug is inherited tick to tick while at least half of the smaller member set is shared; when a slug comes back after a gap with different members it gets a new id, so a time view should key on `id`, not on `slug`. Snapshots taken before 2026-09-14 have no stored id and answer `null`.
| GET | `/trend` | `{ narratives: string[], rows: [{from, launches, buys, eth, narratives: {name: pct}}] }` — precomputed for 48 h in 4 h steps (recomputed every 15 min); other `hours`/`step` values return `BAD_TREND` | holders |
| GET | `/stream` | SSE: `hello`, then `LAUNCH`, `STATUS`, `EDGE`, `GRAD`, `JOIN`, `SYNC`, `ping`; `data:` is a `WatchEvent` | anonymous viewers get events 5 minutes late |
| GET | `/events?since=<unix\|ms\|iso>` | `{ since, until, delayed_s, events: WatchEvent[] }` — the polling twin of `/stream`; pass the returned `until` as the next `since`. Use this behind proxies that buffer SSE (Cloudflare quick tunnels do) | same delay rule |
| GET | `/schema/:name` | JSON Schema | no |
| GET | `/og/cluster/:slug`, `/og/coin/:ca` | SVG 1200×630 share card; add `/png` for `image/png` (X previews need PNG) | no |
| POST | `/holders/check` `{ address }` | `{ address, balance, threshold, ok, token? }` and sets the `narra_holder` cookie when `ok` | no |

Holder mode is postponed to after the launch, so every route is open and nothing is gated; the `Gate` column describes the future behaviour only. Once the token is live, gated routes answer `401 { error: { code: "HOLDER_REQUIRED" } }` without the cookie; send the cookie back (or the token as `x-narra-holder`) through your proxy. Other errors: `400 BAD_ADDRESS | BAD_QUERY | AMBIGUOUS`, `404 NO_CLUSTER | NO_SCHEMA | NOT_FOUND`, `429 RATE_LIMITED` (60/min per IP anonymous, 600/min holders), `503 WARMING_UP` for the first minute after a restart.

OG images: point `og:image` at the `/png` variant; the SVG is there for inline use.

### The shapes you will render

`NowOut` (board):

```jsonc
{
  "schema_version": "1.0.0", "computed_at": "2026-09-13T15:30:46Z", "window": "60m",
  "window_from": 1789309620, "window_to": 1789313220, "head_block": 62064460, "lag_blocks": 0,
  "source": { "rpc": "chainstack", "mode": "cache" }, "quote_unit": "ETH",
  "counts": { "candidates": 1508, "clustered": 538, "trades": 44910, "launches": 1278, "sprayers": 42 },
  "clusters": [{
    "slug": "ponsora-cult", "label": "ponsora · cult", "label_source": "tags", "rank": 1,
    "status": "ROTATING IN",                      // HOT | EMERGING | ROTATING IN | ROTATING OUT | COOLING | DEAD
    "narrative": "mixed", "narrative_sub": null, "narrative_mix": { "crypto": 0.4, "money": 0.2 },
    "top_tags": [{ "tag": "ponsora", "weight": 1.2 }, { "tag": "cult", "weight": 0.9 }],
    "n_members": 9,
    "heat": { "n_launches": 7, "n_members": 9, "n_alive": 9, "quote_norm_in": 231.4, "unique_buyers": 1985, "n_graduated": 1,
              "graduated_share": 0.11, "taxed_ratio": 0.1, "pool_volume_norm": 12.3, "delta_pct": 140, "pair_mix": { "eth": 7, "stable": 1, "stock": 1, "other": 0 } },
    "links": { "text": 28, "wallet": 3, "deployer": 0, "semantic": 0 },
    "cohorts": { "sniper": 45, "sprayer": 3, "rotator": 416, "early-in-hot": 120, "total": 1985 },
    "flow": { "in_wallets": 21, "in_eth": 3.1, "out_wallets": 0, "out_eth": 0 },
    "rotating_from": "fort-sol", "rotating_to": null,
    "summary": "…", "members": [ /* only with members=1 */ { "token": "0x…", "symbol": "SOUP", "name": "…", "phase": "curve", "membership": 0.81, "buyers_overlap": 14, "last_trade_ts": 1789313000, "launched_ts": 1789310000, "curve_progress": null } ]
  }]
}
```

`CoinOut` (card):

```jsonc
{
  "token": "0xac42…", "symbol": "Roblonks", "name": "Roblonks", "phase": "curve",   // curve | swept | pool | rescued
  "curve": { "real_quote_eth": 0.01, "threshold_eth": 4.2, "progress": 0.002 }, "pool": null,
  "pair": { "address": "0x0…", "symbol": "ETH", "kind": "eth" }, "launched_at": 1789312000, "deployer": "0x…",
  "verdict": "OUT",                                       // IN | EDGE | OUT | ORPHAN | NOISE | NOT_PONS
  "cluster": { "slug": "cat-fart", "status": "ROTATING IN", "membership": 0.52 },
  "alternatives": [{ "slug": "cheese-rotating", "membership": 0.51 }],
  "reasons": ["74/100 early buyers also bought $POWER, $cheese in this window", "…"],
  "watch": ["41 of 100 early buyers bought goatsen in the last 10m → rotating out risk"],
  "narratives": ["crypto"],
  "popularity": { "cluster_rank": 2, "clusters_total": 107, "rank_in_cluster": null, "cluster_size": 9, "buyers": 814, "buyers_percentile": 99 },
  "evidence": { "early_buyers": 100, "overlap_buyers": 74, "text_score": 0.3, "wallet_score": 0.74, "launch_tx": "0x…", "launch_block": 62058593 },
  "schema_version": "1.0.0", "computed_at": "…", "window": "60m", "head_block": 62064460, "lag_blocks": 0, "source": { … }
}
```

`NotPonsOut`: `{ token, verdict: "NOT_PONS", reasons: [string], …meta }`.

`FlowOut`: `{ nodes: [{ slug, status }], edges: [{ from, to, wallets, quote_norm, deployers }], …meta }`.

`WhyOut`: `{ cluster: Cluster & { members: Member[] }, tags: [{ tag, weight, examples: string[] }], edges_in: Edge[], edges_out: Edge[], rule: string, …meta }`.

`WatchEvent` (SSE `data:`): `{ type: "LAUNCH"|"STATUS"|"EDGE"|"GRAD"|"JOIN"|"SYNC", ts, slug?, from?, to?, token?, symbol?, wallets?, note? }`.

Rules that matter to you:
- `reasons` and `watch` are finished sentences. Render them verbatim, never paraphrase or summarise.
- Numbers: ETH with 1 decimal above 10 and 2 below; whole percentages; times as "41m ago" / "2h ago".
- `rank_in_cluster` can be `null` even with a cluster: the token joins the meta through wallets, not by name. Say "joins it by wallets".
- Fields never disappear within `schema_version` 1.x; new ones may appear. Ignore unknown fields.

## 3. What to build (day 0)

| Page | What | Gate |
|---|---|---|
| `/` | the board + a "paste a CA" field | none |
| `/coin/[ca]` | the verdict card | none |
| `/cluster/[slug]` | one meta: numbers, members, tags, edges | none (7-day history: holders) |
| `/flow` | the edge table | holders |
| ~~`/holders`~~ | **postponed** (owner's decision, 2026-09-14): holder mode is off the launch scope; drop the page or keep a one-line note. Everything is open to everyone. | — |
| `/docs` | how it is computed, in plain words | none |

Behaviour that is not optional:

1. **The board opens with the answer.** Before the table: how many metas in which statuses, total ETH and buyers, the hottest meta, where capital is draining (the meta with the most outgoing wallets and how many metas it feeds), narrative shares. The CLI prints exactly this block; copy its logic (`src/cli/now.ts → renderNow`).
2. **Top 15 by default, DEAD hidden**, "… N more" expands. Rows update in place every 30 s or on an SSE `STATUS` event; sort order changes only when a status changes, so rows do not jump.
3. **The card replaces the board**, it is not a modal. Verdict large, one word, in colour; cluster status next to it; the `popular` line; reasons as a list; watch-outs in yellow; sources at the bottom; the sentence *"IN means this token belongs to a live meta. It is not a buy signal."* under every card.
4. **No wallet.** No `Connect`, no `window.ethereum`, no signatures. (Holder mode is postponed; ignore `POST /holders/check` and the gate columns below until it returns.)
5. **Stale is visible, never blank.** If `/health` is unreachable or the last snapshot is older than 3 minutes: keep the last data and show `data is N min old — indexer catching up`.
6. **Share = screenshot.** Each card and meta page has an OG image (served by the backend, you only set the meta tags) and a `?frame=1` mode: header and filters hidden, font +25 %, width fixed at 1080 px, for vertical video frames.
7. **Phone first for the card.** A pasted CA from the X app is the main entry. The board at 400 px wraps a row to two lines.

## 4. Look

A terminal, not a dashboard. Dark only on day 0. One monospace face for data, one grotesk for headings. Status is always word + colour, never colour alone. No icons, no token logos on the board.

| Token | Value | Use |
|---|---|---|
| `bg` | `#0B0C0E` | page |
| `panel` | `#131519` | panels |
| `line` | `#23262D` | borders |
| `fg` | `#E6E7EA` | text |
| `dim` | `#8A8F99` | secondary |
| `hot` | `#FF5A36` | HOT, ROTATING IN |
| `warm` | `#FFB020` | EMERGING |
| `cool` | `#4F8CFF` | COOLING |
| `dead` | `#4A4F58` | DEAD |
| `out` | `#B66CFF` | ROTATING OUT, OUT verdict |
| `ok` | `#3DDC97` | IN verdict |

Copy rules: the site is in English; never the words *buy, signal, alpha, guaranteed*; board title `what's printing on Pons right now`.

Run `npx tsx bin/narra.ts terminal` in the repo once: it is the reference for density and hierarchy, and the site should feel like its web twin.

## 5. Stack and wiring

- **Hosting: Cloudflare Workers** (live since 2026-09-14). `web/` on branch `site` is Next.js through `@opennextjs/cloudflare`; `web/wrangler.jsonc` carries the Worker name `narra-web`, the runtime vars and the custom domains `narrahood.com` + `www.narrahood.com`. Deploy by hand with `cd web && NARRA_API_URL=https://api.narrahood.com NEXT_PUBLIC_SITE_URL=https://narrahood.com npx opennextjs-cloudflare build && npx wrangler deploy` (after `npx wrangler login`), or let `.github/workflows/deploy-site.yml` do it on every push to `site` once the repository has the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. No Vercel.
- **Framework**: your call within what Pages runs natively. Two good fits: **Astro** (SSR adapter `@astrojs/cloudflare`, minimal JS by default, easy islands for the live board) or **Next.js through `@opennextjs/cloudflare`**. SvelteKit with `adapter-cloudflare` also works. Pick the one you are fastest in; the site is a handful of pages, not an app platform.
- **API proxy**: a Pages Function at `functions/api/[[path]].ts` forwards `/api/*` to the backend (`NARRA_API_URL`, set in the Pages project's environment variables), passes the `narra_holder` cookie through in both directions, and streams `/api/stream` without buffering. Same-origin means no CORS and the cookie stays `httpOnly`. Proxy `/api/og/*` as well and set `og:image` to it.
- **Rendering**: server-render the first screen from the API (edge cache `s-maxage=15, stale-while-revalidate=60` on `/` and `/cluster/*`, `30` on `/coin/*`), then SSE (`EventSource("/api/stream")`) with a 30 s polling fallback.
- **Env** (Cloudflare dashboard, production and preview): `NARRA_API_URL=https://api.narrahood.com`, `NEXT_PUBLIC_SITE_URL=https://narrahood.com`. The domain is `narrahood.com` on Cloudflare; the API is reachable at `api.narrahood.com` through a Cloudflare Tunnel (live; `https://api.narrahood.com/api/health`).
- No analytics, no third-party scripts, one self-hosted font. Cloudflare's free WAF rate-limit rule on `/api/*` (120 requests/min per IP) in front of the backend's own limits.

## 6. Acceptance

1. `/` on a phone and a desktop: the summary block, then the board; rows update without reload.
2. Paste a live Pons CA: the card with a verdict and at least three reasons in under 2 s.
3. Paste a non-Pons address: a clear message, not an error page.
4. Kill the backend: the board keeps the last data and shows the banner; the card shows a message with retry.
5. Click a meta: members expand; a link with `?c=slug` opens the same state.
6. (dropped for now) holder mode is in the roadmap, not in the launch scope.
7. An X preview of a `/coin/[ca]` link shows the verdict and reasons.
8. Nowhere a wallet-connect button; nowhere the words buy / signal / alpha / guaranteed.

## 7. How to hand it back

A repository with `README.md` (how to run, env vars), the Vercel project linked, and a short `NOTES.md`: what deviates from this file and why. Open questions go to us before you build around them — the API is ours to extend, so ask for a field rather than deriving it on the client.

## 8. Answers to `NOTES.md` (site branch, 2026-09-14)

1. **npm**: `narra-cli` is not published yet (owner's call); until then generate types from `schemas/*.json` as you do, or add the repo as a git dependency. The schemas folder now covers every response.
2. **Schemas**: added `not_pons`, `find`, `trend`, `history_cluster`, `history_token`, `holders_check`, `health`, `error` — `schemas/*.json` in the repo and `/api/schema/<name>` on the service.
3. **`NOISE`**: reserved for the social-signal module (X mentions vs on-chain); nothing assigns it today. Render it like `ORPHAN` with the label "social only" if it ever appears.
4. **`popularity.buyers` 52 → 0**: `buyers` and the percentile are counted inside the requested window; early buyers are all-time. A token whose buys fell out of the window shows 0 — correct, but the wording was misleading. Cards and readings now say "no buyers in this window" instead of "more than 0% of tokens". Show the percentile only when `buyers > 0`.
5. **Disclaimer**: use *"IN means this token belongs to a live meta. It is not a recommendation."* — the same sentence the CLI, the bot and the terminal print.
6. **Windows**: fixed. An unknown value or one the service does not compute answers `400 BAD_WINDOW`; a configured window that is not ready answers `503 WARMING_UP`. The service never substitutes 60m any more.
7. **Pons links**: fixed to `https://www.ponsfamily.com/launchpad/<ca>` in the engine.
8. **Runtime validation**: `schemas/*.json` are JSON Schema 2020-12; validate with any JSON-Schema library, or wait for the npm package and use the zod objects.
9. **Totals**: aligned. The CLI answer block now counts live metas only (DEAD excluded), exactly like `reading`. The count of metas by status still lists DEAD separately.
10. **Readings on `/api/history/*` and `/api/trend`**: covered by the schemas in (2).

Repository note: the `site` branch removed the engine and the service. Keep the site in `web/` next to them (or in its own repository) so one checkout runs both; nothing from `site` should be merged into `master`.
