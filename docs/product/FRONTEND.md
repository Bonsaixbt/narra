# NARRA — frontend spec (phase 2, the site)

Date: 2026-09-13
Product: the web board for the narra terminal on Pons v2 / Robinhood Chain
Status: draft toward launch day

Related: `docs/product/BACKEND.md` (API and types), `docs/OSS.md`, `docs/GUIDE.md`.

---

## 0. Principles

1. The site is a wrapper over the same engine as the CLI. No verdict logic on the client: everything comes from the API.
2. No wallet. Not a single `Connect` button. No `window.ethereum`. The holder gate is a pasted public address only.
3. A screen is a video frame. Every page must read from a phone in three seconds and look good in an X screenshot.
4. The site survives a dead backend: it shows the last snapshot with a "data is stale" banner, not a blank page.
5. No "buy" language. `IN` is membership in a meta, not a signal.

---

## 1. Pages

| Path | What | Gate |
|---|---|---|
| `/` | the board + "paste a CA" field | no |
| `/coin/[ca]` | the verdict card for a token | no |
| `/cluster/[slug]` | a meta: members, tags, edges, history | 7-day history — holders |
| `/flow` | the capital-flow graph between metas | holders |
| `/wallets` | wallet cohorts | holders |
| `/holders` | holder check and extended mode | no |
| `/docs` | how it is computed: tags, statuses, flow, limits | no |
| `/api/og/...` | server-rendered PNG previews (proxied from the backend) | no |

The `15m` and `4h` windows, flow, wallets, history and the undelayed live stream are for holders. The `60m` window, the card and search are always free.

---

## 2. Stack

- Astro or Next.js (via `@opennextjs/cloudflare`), TypeScript. Deployed on **Cloudflare Pages** from the GitHub repository with automatic deploys and PR previews.
- Tailwind CSS 4. No UI library: few components, a terminal style, kits only get in the way.
- Data: server-rendered first screen from the API with edge caching (15 s for the board and cluster pages), then live updates through SSE (`EventSource` on `/api/stream`) or polling every 30 s when SSE is unavailable.
- Response types imported from the shared `narrahood` zod schemas. One source of truth.
- Env (Pages dashboard): `NARRA_API_URL` (the backend), `PUBLIC_SITE_URL`.
- No analytics, no cookies except the holder token, no external fonts except one monospace face with a local fallback.

---

## 3. Visual language

A terminal, not a dashboard. One monospace font for data, one grotesk for headings and docs.

Palette (dark by default; a light theme is not needed on day 0):

| Token | Value | Where |
|---|---|---|
| `bg` | `#0B0C0E` | background |
| `panel` | `#131519` | panels |
| `line` | `#23262D` | borders |
| `fg` | `#E6E7EA` | text |
| `dim` | `#8A8F99` | secondary text |
| `hot` | `#FF5A36` | `HOT`, `ROTATING IN` |
| `warm` | `#FFB020` | `EMERGING` |
| `cool` | `#4F8CFF` | `COOLING` |
| `dead` | `#4A4F58` | `DEAD` |
| `out` | `#B66CFF` | `ROTATING OUT`, `OUT` |
| `ok` | `#3DDC97` | `IN` |

A status is always text plus colour, never colour alone. No icons. Token logos are not shown on the board (IPFS is slow and noisy), only on the card, lazily.

Density: at 1280 px the board shows 8–10 metas without scrolling. A cluster row is one line of text, like the CLI.

---

## 4. Screens

### 4.1 `/` — the board

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ NARRA   what's printing on Pons right now       [ paste CA ________ ] [→]    │
│ 12:04:11 UTC · window [15m] [60m] [4h] · pair [all] [eth] [stable] [stock]   │
│ hottest ponsora-cult 231 ETH · draining fort-sol → 20 metas · chinese 25%    │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1 ROTATING IN  ponsora-cult   mixed        7 CA  231.4 ETH  1 grad  1985 b ⇦21│
│ 2 ROTATING IN  cat-fart       animals     36 CA   93.9 ETH  1 grad  1005 b ⇦51│
│ 3 HOT          ponsorian      mixed       13 CA   36.8 ETH  1 grad   462 b    │
│ 4 EMERGING     cheese-rotat.  mixed       44 CA   66.2 ETH  0 grad  1046 b ⇦46│
├──────────────────────────────────────────────────────────────────────────────┤
│ cat-fart  ·  ROTATING IN  ·  animals  ·  tags cat fart cheese                │
│   0xabc…  $cheese     curve 0.81   IN   14 buyers overlap                    │
│   0xdef…  $FARTCAT    curve 0.35   EDGE weak overlap                         │
│                                                       open meta → │
└──────────────────────────────────────────────────────────────────────────────┘
```

Behaviour:

- Server-rendered with the `60m` window. Clicking a row expands the member panel below the table (no navigation); the URL gets `?c=cat-fart` so a link opens the same state.
- Switching to `15m`/`4h` without the gate shows a "for holders" panel with a link to `/holders`; the `60m` data stays on screen.
- The pair filter is client-side, on `pair_mix`.
- Arrows `⇦`/`⇨` are flow: wallets that arrived and left; hover shows counts and ETH.
- Every 30 s (or on an SSE `STATUS` event) rows update in place. A status change highlights the row for 2 s. Rows do not jump: sorting is recomputed only on a status change.
- The summary line (hottest, draining, narrative shares) is the same block the CLI prints first.
- The CA field validates `0x` + 40 hex on the client; `Enter` → `/coin/[ca]`. Pasted addresses with whitespace are cleaned.
- A banner above the table when `health.lag > 300` or the snapshot is older than 3 minutes: `data is N min old — indexer catching up`. The data stays.

Empty state: "no live meta right now — N launches in the last hour, none clustered", plus the last 5 launches.

### 4.2 `/coin/[ca]` — the card

```
┌──────────────────────────────────────────────────────────────┐
│ $Roblonks · Roblonks                          0xac4…8f [copy] │
│ phase: curve 0.01 / 4.2 ETH · launched 11m ago · pair ETH     │
│                                                              │
│ OUT  cat-fart  0.52                             ROTATING IN  │
│ popular  meta #2 of 107 · joins it by wallets · 814 buyers   │
│ alt: cheese-rotating 0.51                                    │
│                                                              │
│ reasons                                                      │
│  · 74/100 early buyers also bought $POWER, $cheese           │
│  · 7 rotators and 71 early-in-hot wallets among early buyers │
│  · cluster cat-fart is ROTATING IN: 36 CA, 94 ETH, 1 grad    │
│ watch                                                        │
│  · 41 of 100 early buyers bought goatsen in the last 10m     │
│                                                              │
│ sources: launch tx ↗ · block 62 058 593 · computed 15:32     │
│ [ open meta ]  [ explorer ↗ ]  [ pons ↗ ]  [ share ]         │
└──────────────────────────────────────────────────────────────┘
```

Behaviour:

- Server-rendered from `GET /api/coin/:ca`. 30 s cache.
- States: `loading` (a skeleton card), `NOT_PONS` ("this address is not a Pons v2 launch"), `ORPHAN` (a card without a cluster, with reasons "no live cluster matches"), API error ("couldn't compute — try again").
- The verdict large, one word, in colour. Next to it the cluster status. Below, the reasons as a list, unabridged.
- `share` copies the link; the OG preview is a server PNG from `/api/og/coin/:ca.png` with the same content at 1200×630.
- `pool` phase shows `pool · graduated 2h ago · 0.6 ETH volume / 60m` instead of curve progress. `swept` phase: `swept — pool not open yet`.
- A refresh button re-requests the verdict, at most once per 30 s.

### 4.3 `/cluster/[slug]`

Three blocks: the header with status and numbers for the chosen window; the member table (the same columns as the board panel plus `last trade`); tags with weights and "why it is named so" (top-5 tokens per tag). Below, `in`/`out` edges as a list. For holders a 7-day history chart: `quote_norm_in` and the status strip in 15-minute snapshots, a single line and a status band, no eight-series legend.

### 4.4 `/flow`

Edges as a table: `from → to · wallets · ETH · deployers · window`. No graph on day 0; a table is more honest and reads on a phone. A graph, if ever, only as an addition to the table.

### 4.5 `/wallets`

The cohort table from the CLI: wallet, buys/sells, tokens, ETH in/out, net, wins, entry delay, cohorts, metas. Filters by cohort. The note "net ignores what is still held; cohorts are arithmetic labels, not a signal".

### 4.6 `/holders`

One "public address" field, a `check` button. `POST /api/holders/check`. Success: "N $NARRA · threshold M · extended mode on", a 24 h cookie is set, a `holder` mark appears in the header. Failure: the balance and the threshold, a link to the Pons page of the token. Copy: "we read a public balance, we never ask for a signature".

Before the token launch (`NARRA_TOKEN_ADDRESS` empty) the page says "holder mode opens after launch" and every gate is open.

### 4.7 `/docs`

Static MDX: how tags, clusters, statuses, flow and the verdict are computed; what the site does not do; sources; limitations. One page with a table of contents on desktop.

---

## 5. Components

| Component | Where | Props |
|---|---|---|
| `Board` | `/` | `clusters`, `window`, `pair`, `selected` |
| `SummaryLine` | Board, header | `hottest`, `draining`, `narratives` |
| `ClusterRow` | Board | `Cluster` |
| `StatusTag` | everywhere | `status` |
| `MemberTable` | Board, Cluster | `members` |
| `VerdictCard` | `/coin` | `Verdict` |
| `ReasonList` | VerdictCard, Cluster | `reasons`, `watch` |
| `FlowArrows` | ClusterRow | `flow`, `rotating_from`, `rotating_to` |
| `CaInput` | header | — |
| `WindowSwitch`, `PairSwitch` | header | `value`, `gated` |
| `StaleBanner` | layout | `health` |
| `GateWall` | windows, flow, wallets, history | `feature` |
| `HistoryChart` | Cluster | `snapshots` |
| `OgCard` | server route | `Cluster \| Verdict` |

Hook `useLiveBoard(window)`: SSE with reconnect, polling fallback, returns `clusters`, `health`, `lastUpdate`.

---

## 6. Data and states

- Every API request is typed through the shared schemas; a response that fails `zod` is an error, not partially rendered.
- Numbers are formatted by one helper: ETH to 1 decimal above 10, 2 below; whole percentages; time as "41m ago" / "2h ago", then a date.
- Addresses: `0xabc…def`, click copies the full one, no tooltip.
- No optimistic updates: the screen shows only what the API returned.
- API error on the board → last successful answer + `StaleBanner`. Error on the card → a message and a retry button.

---

## 7. Holder mode

- The token from `POST /api/holders/check` is stored in an httpOnly cookie `narra_holder` and forwarded to the backend by the Pages Function proxy, so the client never sees the secret.
- The client-side gate only hides and shows; the real check is on the backend.
- A `holder` mark in the header; a "forget" button removes the cookie.

---

## 8. OG cards and the "video frame"

- `/api/og/cluster/[slug]` and `/api/og/coin/[ca]` — PNG 1200×630, the same monospace font, black background, the status in colour, 3–5 lines of data, UTC time at the bottom. Rendered on the backend, proxied and cached 60 s by the frontend.
- `?frame=1` on `/` and `/coin/[ca]`: hides the header and filters, enlarges the font by 25 %, fixes the width at 1080 px. For vertical video: one screen = one frame.

---

## 9. Mobile

- The board at 400 px: a cluster row wraps to two lines, status + name, then numbers. The member panel opens full width.
- The card on a phone is the main scenario (a CA pasted from the X feed). The input stays the first element in the header.
- Tables wider than the screen scroll horizontally inside the table; the page never scrolls sideways.

---

## 10. Accessibility and performance

- Status contrast on the dark background ≥ 4.5:1 (check `dead` and `dim`).
- Full keyboard control: `/` focuses the CA field, `Esc` closes the panel, arrows move between rows.
- The first board screen ≤ 60 KB of JS beyond the framework. No charts on `/`.
- LCP < 1.5 s on 4G for `/coin/[ca]` (server-rendered, no waiting on client requests).

---

## 11. Copy

- The site's language is English, like the account.
- Board title: `what's printing on Pons right now`.
- Under the verdict: `IN means this token belongs to a live meta. It is not a buy signal.`
- Footer: `open source · MIT · no wallet connect · runs on your machine: github.com/…`
- The words `buy`, `signal`, `alpha`, `guaranteed` do not appear on the site.

---

## 12. Deployment

- Cloudflare Pages connected to the GitHub repository: production from the site branch, previews for every pull request, automatic on push.
- A Pages Function (`functions/api/[[path]].ts`) proxies `/api/*` to `NARRA_API_URL` so cookies and the SSE stream stay on one origin; `/api/og/*` is proxied the same way for `og:image`.
- Cache headers: `/` and `/cluster/*` — `s-maxage=15, stale-while-revalidate=60`; `/coin/*` — `s-maxage=30`; OG — `s-maxage=60`.
- Cloudflare WAF rate-limit rule on `/api/*`: 120 requests/min per IP, in front of the backend's own limits.

## 13. Acceptance (day 0)

1. Open `/` on a phone and a desktop: the board with the 60m window, rows update without reload.
2. Paste any live Pons CA: a card with a verdict and at least three reasons in under 2 s.
3. Paste a non-Pons address: a clear message, not a 500.
4. Stop the backend: the board shows the last snapshot and a banner, the card a message with a retry.
5. Click a cluster to expand members; a link with `?c=` opens the same state.
6. `/holders` before the token launch says "opens after launch"; after it, a real balance check without a signature.
7. An OG preview of a `/coin/[ca]` link in X shows the verdict and reasons.
8. Nowhere on the site is there a wallet-connect button.
