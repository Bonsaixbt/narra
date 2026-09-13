# Strategy: how narra decides

Every number on screen can be recomputed from `~/.narra/narra.db` with a SQL query. This file says how.

## 1. Tags

Input: `name`, `symbol`, first 40 words of `description`, pair kind.

1. Lowercase; drop `$ # @`; split camelCase and letter/digit boundaries; keep `[a-z0-9]+` and CJK runs.
2. Drop stop words (`dictionary.json → stop`). Bare numbers never become tags.
3. Aliases map variants to one tag (`robinhood → hood`, `frogs → frog`, `tesla → tsla`). Plural `-s` is stripped from words of five letters or more.
4. Compound tickers are split on seeds (alias keys and values of three or more letters): `HOODRAT → hood + rat`, `GROKTRENCHER → grok + trench`. The whole compound keeps weight 0.3, its parts get the full weight.
5. Weights: symbol 1.2, name 1.0, description 0.4, pair tag 0.6. Repeats take the max, never the sum.

Similarity of two tokens = weighted Jaccard: Σ min / Σ max over the union of tags.

## 2. Clusters

Candidates: every token launched in the window plus every token with a curve buy or pool swap in the window (a token launched hours ago that still trades stays in play).

Links, in order:

| Link | Condition |
|---|---|
| name | tokens share a content tag carried by ≥ 3 candidates and their similarity ≥ 0.35 |
| deployer | same deployer and a shared content tag |
| wallet | ≥ 5 common buyers and ≥ 20 % of the smaller token's buyer set; two name-groups merge only when ≥ min(2, sizes product) token pairs across them qualify |

Before wallet links, sprayers are removed: a wallet that bought more than 8 (15m) / 20 (60m) / 50 (4h) distinct tokens in the window does not vote anywhere, including verdicts.

Connected components of ≥ 3 tokens are clusters. The slug is the two content tags with the highest `support × centroid weight`, requiring ≥ 2 members; a wallet-only cluster with no shared word is named after its two most-bought members. A cluster inherits the slug of a previous tick's cluster when they share ≥ 50 % of the smaller member set.

Membership of a token in its cluster = ½ · min(1, degree / min(size − 1, 6)) + ½ · min(1, 2 · similarity to the cluster centroid).

## 3. Heat (per cluster, per window `[from, to)`)

| Field | Definition |
|---|---|
| `n_launches` | launches of members inside the window |
| `n_alive` | members with a buy in the last `alive_window_sec` (900 s) |
| `quote_norm_in` | Σ quote of member buys on curves + pool buys, in ETH (stables via ETH/USD, stock pairs excluded) |
| `unique_buyers` | distinct `recipient` on curves ∪ `tx.from` in pools |
| `n_graduated` | `PoolGraduated` inside the window |
| `graduated_share` | members in phase `pool` / members |
| `taxed_ratio` | buys with `tax > 0` / buys (the 3-second opening tax marks bots) |
| `delta_pct` | `quote_norm_in` vs the same-length window before it |

## 4. Status

Evaluated top-down; thresholds in `thresholds.json`:

1. `DEAD` — nothing alive.
2. `ROTATING OUT` — outgoing edges ≥ 8 wallets and delta < 0.
3. `ROTATING IN` — HOT or EMERGING conditions and incoming edges ≥ 8 wallets.
4. `HOT` — ≥ 8 launches, ≥ 1.5 ETH, ≥ 1 graduation.
5. `EMERGING` — < 8 launches, delta ≥ +100 %, ≥ 30 buyers; or nothing decisive but ≥ 2 live curves and ≥ 0.1 ETH.
6. `COOLING` — ≥ 8 launches, < 0.5 ETH, delta < −50 %; or a trickle.

Clusters with < 10 buyers and < 3 launches in the window are not published.

## 5. Flow

A wallet sat in cluster A during the previous window if it bought ≥ 2 distinct A tokens there. Edge A→B counts such wallets that bought any B token in the current window and sums their ETH into B. Deployers add a second count: launched in A before, in B now. Edges publish at ≥ 5 wallets or ≥ 2 deployers.

## 6. Verdict

For a token T and each published cluster C:

- `text` = min(1, 2 · similarity(tags(T), centroid(C)))
- `wallet` = |early buyers of T also buying other members of C| / |early buyers of T|, early = first 100 buys
- `membership` = ½ text + ½ min(1, 2 · wallet)

Best cluster wins. Then:

| Verdict | Rule |
|---|---|
| `ORPHAN` | best membership < 0.25 |
| `OUT` | best cluster not live (COOLING, DEAD, ROTATING OUT), or ≥ 30 % of early buyers also in another cluster |
| `IN` | membership ≥ 0.5 and ≥ 2 overlapping early buyers |
| `EDGE` | otherwise |

Reasons are sentences generated from the numbers above; nothing in them is free text from a model.

## 7. Known blind spots

- Timestamps inside a 2 000-block chunk are interpolated between the chunk's edge blocks (±1 s).
- Stock-token pairs (NVDA, TSLA, …) carry no ETH value until a price source exists; their clusters are ranked by buyers and launches.
- Curves that emit `CurveBuy` but were launched more than 600 000 blocks (~17 h) ago are not resolved to a token.
- Buyer sets are window-wide; the "moved in the last 10 minutes" rotation signal is approximated by window-wide overlap in v0.1.
- Thresholds are starting values (`calibrated_on: null`). Expect them to change after a week of snapshots.
