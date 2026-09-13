# Architecture

One Node process, no daemon, no service. TypeScript, ESM, three runtime dependencies (`viem`, `better-sqlite3`, `@modelcontextprotocol/sdk`) plus `zod` for schemas.

```
bin/narra.ts            argv → src/cli/index.ts
src/
  chain/       constants · abi · topics · rpc (the gate: capability routing, concurrency caps, penalty box)
  ingest/      decode (logs → rows) · blocks (timestamps, block-at-time) · sync (chunked backfill + cursor) · enrich (multicall metadata, pairs, ETH/USD)
  store/       schema (embedded SQL) · db (typed rows, window queries, snapshots, retention)
  analyze/     tokenize + dictionary.json · cluster · heat · thresholds.json · status · flow · verdict · board (one tick)
  cli/         args · render · now · coin · flow · why · watch · doctor · backfill · serve · schema · cache
  mcp/         server (five tools, one prompt, stdio)
  schemas.ts   zod schemas → JSON Schema; the contract for --json, HTTP, MCP and the library
  narra.ts     the facade: Narra { sync, now, coin, flow, why, doctor }
  lib.ts       public exports
```

Data flow per command: `sync` (logs → SQLite) → `analyze` (rows → clusters → heat → status → edges → snapshots) → presenter (table, JSON, MCP text, HTTP). `--offline` skips the first step.

`watch` and `serve` re-run the tick every N seconds and diff the previous result into events. v0.1 polls; the websocket subscription is wired in `chain/rpc.ts` and lands in v0.2.

Tests (`node:test`, no network): `test/*.test.ts`, fixtures in `test/fixtures/` are 600 real blocks of factory and curve logs.
