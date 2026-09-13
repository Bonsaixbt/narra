# narra in n8n / Make / any HTTP node

1. Run `narra serve --port 4663` on the same machine (or in the same container) as the workflow runner.
2. Add an **HTTP Request** node:
   - `GET http://127.0.0.1:4663/coin/{{ $json.address }}` → verdict object
   - `GET http://127.0.0.1:4663/now?window=60m` → board
   - `GET http://127.0.0.1:4663/flow` → edges
3. Branch on `{{ $json.verdict }}` (`IN`, `EDGE`, `OUT`, `ORPHAN`, `NOT_PONS`) and post `{{ $json.reasons.join("\n") }}` wherever you like.
4. For live events, an **SSE** node on `http://127.0.0.1:4663/stream` receives `LAUNCH`, `STATUS`, `EDGE`, `GRAD`, `JOIN`, `SYNC`.

The server binds loopback only. Put a reverse proxy with auth in front if the runner is elsewhere.
