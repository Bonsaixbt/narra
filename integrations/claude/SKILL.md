---
name: narra
description: Use when a user mentions a Pons / Robinhood Chain token, pastes a 0x contract address from that chain, or asks which meta is hot on Pons right now. Runs the narra CLI (read-only) and reports verdicts with their reasons.
---

# narra — metas on Pons v2 / Robinhood Chain

narra is a read-only terminal tool. It never signs or sends transactions.

## When to run what

| User says | Run |
|---|---|
| "what's printing / what meta is hot on Pons" | `narra now --json` |
| pastes a `0x…` address (40 hex) | `narra coin <CA> --json` — always first, before any opinion |
| "where is the money rotating" | `narra flow --json` |
| "why is X grouped like that" | `narra why <slug> --json` |
| "who is rotating / which wallets are early" | `narra wallets --cohort rotator --json` (flow cohorts, never a follow signal) |
| pastes a wallet address and asks what it does | `narra wallet <0x…> --json` |
| "history of this meta / token" | `narra history <slug|CA> --json` |
| tool errors, weird numbers | `narra doctor --json` |

If `narra` is not installed: `npx -y narra-cli <command>`.

## How to read the output

- `verdict`: `IN` = belongs to a live meta · `EDGE` = name fits, capital does not · `OUT` = the meta is cooling/dead or the buyers left · `ORPHAN` = matches nothing · `NOT_PONS` = not a Pons v2 launch.
- `reasons[]` and `watch[]` are sentences built from the numbers. Quote them verbatim; do not paraphrase them into stronger claims.
- `cluster.status`: `HOT`, `EMERGING`, `ROTATING IN` are live; `ROTATING OUT`, `COOLING`, `DEAD` are not.
- `evidence` has the raw counts if the user wants to argue with a number.

## Rules

1. `IN` is membership, not a recommendation. Never turn it into "buy".
2. Do not suggest entries into `OUT` / `ORPHAN` tokens or `DEAD` / `COOLING` clusters. Say plainly that the meta is not live.
3. Mention `computed_at` and `window`: this data ages in minutes.
4. Exit codes with `--quiet`: 0 IN, 1 EDGE, 2 OUT, 3 ORPHAN, 4 NOT_PONS, 10+ error.
