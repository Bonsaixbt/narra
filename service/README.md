# narra service

The narra engine as a hosted service: HTTP + SSE for the site, a holder gate, rate limits, share cards, history beyond the local retention. Same code as `narra-cli`; nothing is computed here that the terminal does not compute.

```sh
cd service && cp .env.example .env     # RPC comes from ../.env or ~/.narra/.env
npm install && npm run dev             # http://127.0.0.1:4663/api/health
```

Routes: `/api/health`, `/api/board`, `/api/coin/:ca`, `/api/find?q=`, `/api/cluster/:slug`, `/api/flow`*, `/api/wallets`*, `/api/wallet/:address`*, `/api/history/cluster/:slug`*, `/api/history/token/:ca`*, `/api/trend`*, `/api/stream` (SSE; anonymous viewers are delayed by `NARRA_PUBLIC_STREAM_DELAY_S`), `/api/schema/:name`, `/api/og/cluster/:slug` and `/api/og/coin/:ca` (SVG; append `/png` for PNG), `POST /api/holders/check`.

`*` holders only once `NARRA_TOKEN_ADDRESS` and `NARRA_HOLDER_SECRET` are set; before that every route is open. The `15m` and `4h` windows on `/api/board` are gated the same way.

Errors: `{ "error": { "code", "message" } }` with `400 BAD_ADDRESS | BAD_QUERY | AMBIGUOUS`, `401 HOLDER_REQUIRED`, `404 NO_CLUSTER | NO_SCHEMA | NOT_FOUND`, `429 RATE_LIMITED`, `503 WARMING_UP`.

Production: `docker compose up -d` (image builds the library and the service; `./data` holds the cache; a sidecar backs the database up hourly and keeps 7 days). Put a TLS reverse proxy in front and set `NARRA_API_ORIGIN` to the site's origin.

Telegram alerts: set `NARRA_TG_BOT_TOKEN` and `NARRA_TG_CHAT_IDS`; see `.env.example`. Deployment: `deploy/VPS.md`.
