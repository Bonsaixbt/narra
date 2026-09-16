# narra service

The narra engine as a hosted service: HTTP + SSE for the site, a holder gate, rate limits, share cards, history beyond the local retention. Same code as `narrahood`; nothing is computed here that the terminal does not compute.

```sh
cd service && cp .env.example .env     # RPC comes from ../.env or ~/.narra/.env
npm install && npm run dev             # http://127.0.0.1:4663/api/health
```

Routes: `/api/health`, `/api/board`, `/api/coin/:ca`, `/api/find?q=`, `/api/cluster/:slug`, `/api/flow`*, `/api/wallets`*, `/api/wallet/:address`*, `/api/history/cluster/:slug`*, `/api/history/token/:ca`*, `/api/history/flow?window=&hours=&step=`*, `/api/trend`*, `/api/stream` (SSE; anonymous viewers are delayed by `NARRA_PUBLIC_STREAM_DELAY_S`), `/api/schema/:name`, `/api/og/cluster/:slug` and `/api/og/coin/:ca` (SVG; append `/png` for PNG), `POST /api/holders/check`.

`*` would be holders-only once `NARRA_TOKEN_ADDRESS` and `NARRA_HOLDER_SECRET` are set; holder mode is postponed (roadmap), so leave them unset and every route stays open. The `15m` and `4h` windows on `/api/board` are gated the same way.

Errors: `{ "error": { "code", "message" } }` with `400 BAD_ADDRESS | BAD_QUERY | AMBIGUOUS`, `401 HOLDER_REQUIRED`, `404 NO_CLUSTER | NO_SCHEMA | NOT_FOUND`, `429 RATE_LIMITED`, `503 WARMING_UP`.

Production: `docker compose up -d` (image builds the library and the service; `./data` holds the cache; a sidecar backs the database up hourly and keeps 7 days). Put a TLS reverse proxy in front and set `NARRA_API_ORIGIN` to the site's origin.

Telegram alerts: set `NARRA_TG_BOT_TOKEN` and `NARRA_TG_CHAT_IDS`; see `.env.example`. Deployment: `deploy/VPS.md`.

Community bot (same token): `NARRA_TG_COMMUNITY_CHAT_IDS` gets a board digest when the board changed, at most once per `NARRA_TG_DIGEST_EVERY_S` (3600) and at least once per eight intervals. In any chat the bot is in (or only `NARRA_TG_ALLOWED_CHAT_IDS`) it answers a pasted CA (or any short message containing one) with the coin card, plus `/meta [15m|60m|4h]`, `/hot`, `/why meta`, `/history meta`, `/flow`, `/wallet 0x…`, `/find word`, `/trend`, `/stats`, `/help`; `/alerts on|off` (chat admins) mutes digests and alerts for that chat, stored in the cache. Cards are one line per fact with inline buttons (site, meta, explorer). Alerts (`NARRA_TG_CHAT_IDS`) are one message per `NARRA_TG_ALERT_BATCH_S` and only when a meta went HOT or 15+ wallets moved; graduations alone wait. Long polling, no webhook.

BotFather setup: `/newbot`, then `/setprivacy` → Disable so the bot sees bare addresses in groups; add it to the community chat with permission to post; get the chat id from `https://api.telegram.org/bot<token>/getUpdates` after a message in the chat (group ids are negative).
