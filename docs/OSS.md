# NARRA — ТЗ на открытую терминальную версию

Дата: 2026-09-13
Что это: `narra` — CLI и библиотека, которые целиком работают на машине пользователя и отвечают, какая мета сейчас печатает на Pons v2 / Robinhood Chain и входит ли токен в неё.
Статус: черновик, фаза 1. Хостинг, сайт и холдер-фичи — фаза 2, см. `docs/product/`.

---

## 0. Принцип 

1. **Терминал — продукт.** Всё, что умеет `narra`, доступно из шелла без сайта, без аккаунта, без ключа.
2. **Ноль конфигурации.** `npx narra now` работает сразу на публичных RPC. Свой узел — опция, не требование.
3. **Агент — первый пользователь.** Каждая команда имеет `--json` со стабильной схемой, есть MCP-сервер, библиотечный API и готовые файлы-скиллы. Человек читает тот же вывод, что и модель.
4. **Каждое число открывается.** В JSON у каждого вердикта — блок, транзакция запуска, окно, число покупателей. Никакой магии.
5. **Только чтение.** Нет приватного ключа, нет `--live`, нет автобая. `IN` не значит «покупай».
6. **Свой код.** Ничего из чужих репозиториев. Публичные факты о цепи используются свободно.
7. **Локальные данные.** Кэш в `~/.narra/`, пользователь может удалить его в любой момент.

---

## 1. Что делает

| Вопрос | Команда |
|---|---|
| Какая мета сейчас живая | `narra now` |
| Этот CA в мете? Почему? | `narra coin <CA>` |
| Куда перетекают повторные покупатели | `narra flow` |
| Почему кластер назван так | `narra why <slug>` |
| Что происходит прямо сейчас | `narra watch` |
| Дать доступ агенту | `narra mcp`, `narra serve` |
| Всё ли работает | `narra doctor` |

Не делает: не торгует, не считает выход из мешка, не ранжирует «умные кошельки», не читает X (соцсигнал — отдельный модуль позже).

---

## 2. Установка и первый запуск

```sh
npx narra now              # без установки
npm i -g narra && narra now # глобально
bunx narra now             # bun
git clone … && npm i && npm run now   # из репо
```

Требования: Node ≥ 22. Runtime-зависимости: `viem` (ABI и RPC-транспорт), `better-sqlite3` (кэш), `@modelcontextprotocol/sdk` (MCP). Всё остальное — свой код. Никаких сборщиков TUI.

Первый запуск без кэша:

```
narra · cold start · fetching last 60m from public RPC
  launches   ████████████ 36 000 blocks   1 261 launches
  trades     ████████████                31 402 buys · 22 118 sells
  pools      ████████████                    41 swaps
  ready in 68s · cache ~/.narra/narra.db
```

Замер на публичном узле 2026-09-13: 3 000 блоков (5 мин цепи) по трём топикам читаются за 6 с. Час — около минуты холодного старта, дальше инкрементально за секунды. `--window 15m` для быстрого первого взгляда.

---

## 3. Команды

Общие флаги: `--json`, `--jsonl` (для потоков), `--window 15m|60m|4h`, `--pair all|eth|usdg|stock`, `--rpc <url>`, `--quiet`, `--no-color`, `--db <path>`.

### `narra now`

```
META  12:04:11 UTC   window 60m   pair all   head 61 834 396   lag 2

HOT          stock-hood     18 CA   2.41 ETH   3 grad   31% pool   ← agent-grok (11 w)
EMERGING     astra-hands     7 CA   0.83 ETH   0 grad    0% pool
COOLING      frog-exit      22 CA   0.19 ETH   0 grad    5% pool   → stock-hood (9 w)
DEAD         office-bot     11 CA   0.00 ETH   0 grad    0% pool

narra why stock-hood · narra coin <CA> · narra flow
```

`--top N` ограничивает строки. `--members` раскрывает членов под каждым кластером.

### `narra coin <CA>`

```
$HOODRAT · HoodRat · 0xabc…def
phase curve 1.9/4.2 ETH · launched 41m ago · pair ETH

IN   stock-hood   0.81   (cluster HOT)
alt  astra-hands  0.22

reasons
  ticker HOOD matches cluster tag hood
  14/31 early buyers also bought $HOODAI, $HOODX in last 40m
  cluster stock-hood is HOT: 18 CA, 2.4 ETH in, 3 graduations / 60m
watch
  6 early buyers bought $ASTRA* in last 10m → rotating out risk

sources  launch tx 0x…  block 61 834 120  computed 12:04:40 UTC
```

Принимает несколько адресов: `narra coin 0xa… 0xb…`. Читает из stdin: `echo 0xa… | narra coin -`.

Коды выхода с `--quiet` (для скриптов и агентов без парсинга):

| Код | Вердикт |
|---|---|
| 0 | `IN` |
| 1 | `EDGE` |
| 2 | `OUT` |
| 3 | `ORPHAN` |
| 4 | `NOT_PONS` |
| 10+ | ошибка (RPC, ввод) |

### `narra flow`

```
from          → to            wallets   ETH    deployers   window
agent-grok    → stock-hood       11     0.62       2        60m
frog-exit     → stock-hood        9     0.31       0        60m
stock-hood    → astra-hands       6     0.18       1        60m
```

### `narra why <slug>`

Теги с весами, топ-5 токенов на тег, правило, по которому связаны члены, текущие числа.

### `narra watch`

Построчная лента. Типы: `LAUNCH`, `STATUS` (смена статуса кластера), `EDGE` (новое ребро), `GRAD` (градуация), `JOIN` (токен вошёл в кластер). `--only STATUS,EDGE` фильтрует. `--jsonl` печатает по объекту на строку. Без полноэкранного TUI в v0.1.

### `narra doctor`

RPC (HTTPS и WSS), chainId, живые параметры фабрики против ожидаемых, состояние кэша, лаг, размер БД, версия схемы JSON.

### `narra serve [--port 4663]`

Локальный HTTP на loopback с теми же ответами, что `--json`: `/now`, `/coin/:ca`, `/flow`, `/why/:slug`, `/stream` (SSE), `/health`, `/schema`. Для любого языка и для n8n/Make. Только `127.0.0.1`, без CORS наружу.

### `narra mcp`

MCP-сервер по stdio. См. §6.

### `narra schema [now|coin|flow|why|watch]`

Печатает JSON Schema ответа. Агент может прочитать схему перед вызовом.

### `narra backfill --hours 4` · `narra cache clear`

Служебные.

---

## 4. Формат JSON

Все ответы имеют `schema_version` (семвер, ломающие изменения только с мажором), `computed_at`, `window`, `head_block`, `lag_blocks`, `source: { rpc, mode: "cold"|"cache"|"live" }`.

```jsonc
// narra coin 0xabc… --json
{
  "schema_version": "1.0.0",
  "token": "0xabc…", "symbol": "HOODRAT", "name": "HoodRat",
  "phase": "curve",                      // curve | swept | pool | rescued
  "curve": { "real_quote_eth": 1.9, "threshold_eth": 4.2, "progress": 0.45 },
  "pool": null,                          // { graduated_at, volume_eth_60m, swaps_60m } в фазе pool
  "pair": { "address": "0x0", "symbol": "ETH", "kind": "eth" },
  "launched_at": "2026-09-13T11:23:10Z", "deployer": "0x…",
  "verdict": "IN",                       // IN | EDGE | OUT | ORPHAN | NOT_PONS
  "cluster": { "slug": "stock-hood", "status": "HOT", "membership": 0.81 },
  "alternatives": [{ "slug": "astra-hands", "membership": 0.22 }],
  "reasons": ["ticker HOOD matches cluster tag hood", "14/31 early buyers also bought …"],
  "watch": ["6 early buyers bought $ASTRA* in last 10m → rotating out risk"],
  "evidence": { "early_buyers": 31, "overlap_buyers": 14, "text_score": 0.9, "wallet_score": 0.72,
                "launch_tx": "0x…", "launch_block": 61834120 },
  "computed_at": "2026-09-13T12:04:40Z", "window": "60m", "head_block": 61834396, "lag_blocks": 2,
  "source": { "rpc": "publicnode+robinhood", "mode": "cache" }
}
```

`reasons` и `watch` — готовые предложения на английском, чтобы модель могла процитировать их без пересказа. `evidence` — числа для тех, кто хочет считать сам.

Правило: ни одно поле не исчезает между минорными версиями; новые добавляются. Схемы лежат в `schemas/*.json` в репо и печатаются командой `narra schema`.

---

## 5. Библиотечный API

```ts
import { createNarra } from "narra";

const narra = await createNarra({ rpc: process.env.RPC_URL, db: "~/.narra/narra.db", window: "60m" });
await narra.sync();                        // инкрементальный догон кэша
const board = await narra.now();           // тот же объект, что narra now --json
const card  = await narra.coin("0xabc…");
for await (const ev of narra.watch({ only: ["STATUS", "EDGE"] })) console.log(ev);
await narra.close();
```

Экспортируются также чистые функции без сети, чтобы их можно было тестировать и переиспользовать: `tokenize(name, symbol, description)`, `cluster(tokens, trades, options)`, `status(heat, thresholds)`, `verdict(token, clusters)`. ESM + типы. CommonJS не нужен.

---

## 6. Интеграция в агентов

### 6.1 MCP-сервер (`narra mcp`)

Инструменты:

| Tool | Вход | Выход |
|---|---|---|
| `narra_now` | `{ window?, pair?, top? }` | доска |
| `narra_coin` | `{ address }` или `{ addresses[] }` | вердикт(ы) |
| `narra_flow` | `{ window? }` | рёбра |
| `narra_why` | `{ slug }` | описание кластера |
| `narra_doctor` | — | здоровье |

Ресурс `narra://board` (обновляется по подписке) и промпт `narra_check_before_entry` с текстом: «если пользователь принёс CA — сначала `narra_coin`; не советуй вход в DEAD, OUT, ORPHAN; всегда цитируй reasons».

Описания инструментов пишутся под модель: короткая фраза, что возвращает, и когда вызывать.

Конфиги в README, копипаст:

```jsonc
// Claude Desktop / Claude Code (.mcp.json) / Cursor / Windsurf / Codex
{ "mcpServers": { "narra": { "command": "npx", "args": ["-y", "narra", "mcp"] } } }
```

```sh
claude mcp add narra -- npx -y narra mcp
```

### 6.2 Файлы-скиллы в репо

```
integrations/
  claude/SKILL.md            # скилл для Claude Code: когда вызывать, какие команды, как читать вердикт
  cursor/narra.mdc            # правило для Cursor
  AGENTS.md.snippet          # блок для AGENTS.md / CLAUDE.md любого проекта
  openai/tools.json          # function-calling схемы для OpenAI-совместимых API
  langchain/narra_tool.py     # обёртка-инструмент на 30 строк, зовёт CLI с --json
  n8n/workflow.json          # HTTP-нода на narra serve
  shell/examples.sh          # jq-пайплайны
```

Содержание `SKILL.md` — одна страница: три команды, формат вывода, коды выхода, правило «reasons цитировать, вердикт не переинтерпретировать».

### 6.3 Шелл и пайпы

```sh
narra watch --jsonl --only STATUS | jq -r 'select(.to=="HOT") | .slug'
narra coin 0xabc… --quiet && echo "in a live meta"
narra now --json | jq '.clusters[] | select(.status=="HOT") | .slug'
curl -s localhost:4663/coin/0xabc… | jq .verdict
```

### 6.4 Для бота на Grok / Telegram / чего угодно

`narra serve` + один HTTP-запрос. Пример на 15 строк в README.

---

## 7. Данные и цепь

Публичные константы (проверяются `narra doctor`):

| | |
|---|---|
| Сеть | Robinhood Chain, chainId 4663, блок ~100 мс |
| RPC по умолчанию | `wss://robinhood-rpc.publicnode.com` для подписок, `https://rpc.mainnet.chain.robinhood.com` для `eth_getLogs`, `https://robinhood-rpc.publicnode.com` для `eth_call` |
| Pons v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Градуация | 4.2 ETH, phantom 1.68 ETH; supply 1e9 |

События: `TokenLaunched`, `LaunchSwept`, `PoolGraduated` на фабрике; `CurveBuy`, `CurveSell` по топику без адреса (одним запросом по всем кривым); `Initialize`, `Swap` на PoolManager для пулов после миграции. Топики трёх основных событий зашиты и сверяются с `keccak256` сигнатур при старте.

Чтение через Multicall3: имя, тикер, `getTokenInfo` (описание, соцсети), запись фабрики, состояние кривой — одним `eth_call` на токен.

Свой RPC-слой: список эндпоинтов с флагами `logs` / `ws`, без batch-запросов, параллельность 2 на публичных узлах, пауза на 429, штрафная скамья на Cloudflare-челлендж, переподписка WSS при тишине 45 с с параллельным поллингом. `--rpc` или `NARRA_RPC_URL` подменяют всё одним приватным узлом.

Кэш: SQLite в `~/.narra/narra.db`, таблицы `launches`, `tokens`, `pairs`, `curve_trades`, `pools`, `pool_swaps`, `cursors`, `cluster_snapshots`. Ретеншн сырых сделок — 48 ч по умолчанию (`NARRA_RETENTION_H`), снапшоты кластеров — бессрочно. Это и есть личная история пользователя.

Нормализация quote: ETH как есть; стейблы через курс ETH/USD с DexScreener (кэш 5 мин, при отсутствии — `stale`); акционные пары без цены считаются по покупателям и CA, не по объёму. В JSON всегда и сырое значение, и нормализованное.

---

## 8. Алгоритмы (кратко, полное описание — `docs/STRATEGY.md`)

**Токенизация.** Имя, тикер, описание → теги. Нижний регистр, разбор CamelCase, стоп-слова, словарь синонимов (`robinhood → hood`), тег пары `pair:eth`. Вес: тикер 1.2, имя 1.0, описание 0.4. Словарь открыт в `dictionary.json`.

**Кластер.** Кандидаты — запуски за окно плюс любой токен со сделками за окно (кривая или пул). Связь двух токенов: взвешенный Жаккар тегов ≥ 0.35, или ≥ 5 общих покупателей, или общий деплоер плюс общий тег. Компоненты связности размером ≥ 3 → кластер. Слаг из двух тяжёлых тегов, наследуется между тиками при пересечении членов ≥ 50%.

**Тепло.** За окно: число CA, живые CA (сделка за 15 мин), quote в ETH (кривые + пулы), уникальные покупатели (`recipient` на кривой ∪ `tx.from` в пуле), градуации, доля покупок под opening tax, доля членов в пуле, дельта к прошлому окну.

**Статус.** `HOT`, `EMERGING`, `ROTATING IN`, `ROTATING OUT`, `COOLING`, `DEAD`. Пороги в `thresholds.json` с датой калибровки. Приоритет: `DEAD > ROTATING OUT > ROTATING IN > HOT > EMERGING > COOLING`.

**Поток.** Кошелёк «в кластере A», если купил ≥ 2 его токена за окно. Ребро A→B: такие кошельки, купившие B в следующем окне; плюс деплоеры, сменившие кластер. Публикуется при ≥ 5 кошельках или ≥ 2 деплоерах.

**Вердикт.** `membership = 0.5·text + 0.5·wallet_overlap` к лучшему живому кластеру. `IN ≥ 0.5` при живом статусе; `EDGE 0.25–0.5`; `OUT`, если кластер остывает или ≥ 30% ранних покупателей за 10 мин ушли в другой; `ORPHAN` иначе.

**После миграции.** Пул ищется по `Initialize` с валютами токена и пары и хуком Pons, poolId сверяется пересчётом ключа. Свопы пишутся по `pool_id`, кошелёк из `tx.from` (контракты по `eth_getCode` в overlap не участвуют). Токен остаётся в кластере, пока торгуется. Метрика `graduated_share` подаётся как причина в `EDGE`/`OUT` для опоздавших запусков.

---

## 9. Репозиторий

```
narra/
  README.md                 # 60 секунд до первого вывода, три команды, MCP-конфиг, JSON-пример
  LICENSE                   # MIT
  package.json              # bin: narra
  bin/narra.ts
  src/
    chain/       constants.ts · abi.ts · rpc.ts · multicall.ts · topics.ts
    ingest/      launches.ts · trades.ts · lifecycle.ts · pools.ts · enrich.ts · pairs.ts · sync.ts
    store/       schema.sql · db.ts · retention.ts
    analyze/     tokenize.ts · dictionary.json · cluster.ts · heat.ts · thresholds.json · status.ts · flow.ts · verdict.ts
    cli/         now.ts · coin.ts · flow.ts · why.ts · watch.ts · doctor.ts · serve.ts · schema.ts · render.ts
    mcp/         server.ts · tools.ts
    lib.ts       # createMeta и чистые функции
  schemas/       now.json · coin.json · flow.json · why.json · watch.json
  integrations/  claude/ · cursor/ · openai/ · langchain/ · n8n/ · shell/ · AGENTS.md.snippet
  docs/          STRATEGY.md · PONS.md · ARCHITECTURE.md · API.md · SAFETY.md
  test/          fixtures/ (записанные логи 3 000 блоков) · *.test.ts
  .github/workflows/ci.yml
```

`docs/SAFETY.md` — что инструмент не делает: не подписывает, не хранит ключ, не советует вход; что уходит в сеть: только JSON-RPC на выбранный узел и один запрос курса на DexScreener (отключается `--no-usd`).

README начинается с живого вывода `narra now` и `narra coin`, потом установка, потом блок «for agents» с MCP-конфигом и JSON. Без роадмапа с обещаниями.

---

## 10. Качество

- TypeScript strict, ESM, `node:test`. Тесты не ходят в сеть: токенизация на 200 реальных именах, кластеризация на синтетике со стабильностью слагов, статусы по таблице порогов, поток, вердикт, декодинг логов, replay 3 000 блоков из фикстур с детерминированной доской.
- CI: lint, typecheck, test на Node 22 и 24, `narra doctor --offline` на фикстурах.
- Перф: холодный старт 60m на публичном RPC ≤ 90 с; `narra coin` из тёплого кэша ≤ 2 с; `narra now` ≤ 1 с; память процесса `watch` ≤ 200 МБ.
- Совместимость: macOS, Linux, Windows (Windows Terminal; цвета и ссылки деградируют корректно).
- Версионирование: `0.1.0` в день публикации репо, `schema_version 1.0.0` замораживается на день 0.

---

## 11. Этапы

**v0.1 — репо публичное**
1. RPC-слой, константы, `doctor`.
2. Ingest фабрики и кривых, кэш, инкрементальный `sync`, холодный старт с прогрессом.
3. Enrich, пары, нормализация.
4. Токенизация, кластеры, тепло, статусы. `now`, `why`, `--json`, `schema`.
5. Вердикт. `coin`, коды выхода, stdin.
6. Поток. `flow`.
7. `watch --jsonl`.
8. `mcp`, `serve`, `integrations/`, README.

**v0.2 — до CA**
9. Пулы v4: `Initialize`, `Swap`, `graduated_share`.
10. Калибровка `thresholds.json` на неделе живых данных, дата в файле.
11. Replay-фикстуры и CI.

**v0.3 — после CA**
Telegram-алерты локально (`narra watch --telegram`), полноэкранный TUI, модуль NOISE как четвёртый сигнал.

**Фаза 2 (наш продукт)** — `docs/product/BACKEND.md` и `docs/product/FRONTEND.md`: хостинг того же пакета как сервиса, история дольше 48 ч, сайт, холдер-гейт. Продукт импортирует `narra` как зависимость, а не форкает.

---

## 12. Открытые вопросы

1. Имя пакета в npm: `narra` занято в npm (v2.0.1), кандидаты `narra-cli` или `narra-terminal`. Проверить занятость перед публикацией.
2. Публичный RPC режет `eth_getLogs` в бурсты. Если холодный старт на нём окажется дольше 2 минут в часы пик — включить по умолчанию `--window 15m` для первого запуска и доносить остальное в фоне.
3. Нужен ли `--window 4h` в OSS или это уже история для фазы 2. Пока да, локально ничего не стоит.
4. Описание токена как источник тегов: возможно шумит, решает калибровка.
