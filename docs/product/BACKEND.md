# NARRA — ТЗ на бэкенд

Дата: 2026-09-13
Продукт: терминал потока мет на Pons v2 / Robinhood Chain
Статус: черновик к дню 0

Связанные документы: `meta-terminal.md` (продукт), `token-launch-playbook-research.md` (контекст), `docs/FRONTEND.md` (сайт).

---

## 0. Принципы

1. Весь код свой. Чужие репозитории не копируются и не портируются. Публичные факты о цепи и контрактах (адреса, сигнатуры событий, параметры протокола) не являются кодом и используются свободно.
2. Каждая цифра на экране открывается до источника: событие, блок, транзакция. Нет «AI увидел ротацию».
3. Без ключа. Бэкенд ничего не подписывает и не отправляет транзакции. Единственная приватная вещь в конфиге — URL Chainstack.
4. Вердикт всегда с причинами. `IN` не означает «покупай».
5. Один процесс на день 0. Индексер, анализатор и API живут в одном Node-процессе, чтобы не строить очереди раньше времени.

---

## 1. Что бэкенд отвечает

| Вопрос | Команда / эндпоинт |
|---|---|
| Какая мета сейчас горячая | `narra now`, `GET /api/board` |
| Куда перетекает капитал | `narra flow`, `GET /api/flow` |
| Этот CA в мете или нет и почему | `narra coin <CA>`, `GET /api/coin/:ca` |
| Что произошло за последние минуты | `narra watch`, `GET /api/stream` (SSE) |
| Почему кластер назван так | `narra why <cluster>`, `GET /api/cluster/:id` |

Не отвечает: «покупать или нет», «сколько выйдет из мешка», «кто умный кошелёк».

---

## 2. Факты о цепи и протоколе

Всё ниже — публичные константы. Каждая проверяется командой `narra doctor` при старте против живой цепи (chainId, `launchEnabled()`, `snipeTaxSeconds()`), расхождение печатается предупреждением.

| Параметр | Значение |
|---|---|
| Сеть | Robinhood Chain mainnet, chainId `4663`, Arbitrum-стек, блок ~100 мс, газ в ETH |
| Платный RPC | Chainstack, archive, HTTPS + WSS. Единственный источник для бэкфила и подписок |
| Публичный RPC | `https://rpc.mainnet.chain.robinhood.com` — fallback только для `eth_call` и коротких `eth_getLogs` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Pons v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Pons meme hook | читается из `factory.memeHook()` при старте, не хардкодится |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Порог градуации (конфиг 0) | 4.2 ETH реального quote, phantom-резерв 1.68 ETH |
| Opening tax | 99% в t=0, спадает до 0 за 3 с |
| Supply | 1 000 000 000 × 1e18 |
| Темп | ~24k запусков и ~560 градуаций в сутки; ~8 покупок на кривых в секунду по всей цепи (замер 2026-09-13) |

### 2.1 События, которые индексируются

Фабрика (`address = factory`):

```
TokenLaunched(address indexed token, address indexed curve, address indexed deployer,
              address pairToken, uint256 launchConfigId, uint256 graduationThreshold)
LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)
PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)
```

Кривые (адрес не фильтруется, только топик — один запрос покрывает все кривые цепи):

```
CurveBuy(address indexed buyer, address indexed recipient,
         uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)
CurveSell(address indexed seller, address indexed recipient,
          uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)
```

Известные топики:

```
TokenLaunched  0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607
CurveBuy       0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455
CurveSell      0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df
```

Остальные топики вычисляются при старте из сигнатуры (`keccak256`) и сверяются с этими тремя как самопроверка.

Uniswap v4 PoolManager (`address = poolManager`), для фазы после миграции:

```
Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1,
           uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1,
     uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
```

### 2.2 View-функции (читаются через Multicall3)

Токен: `name()`, `symbol()`, `decimals()`, `totalSupply()`, `balanceOf(address)`, `getTokenInfo()` → `(deployer, logo, description, socials{twitter, telegram, discord, website, farcaster})`.

Фабрика: `getLaunchedToken(token)` → структура с `curve, deployer, creatorFeeRecipient, pairToken, graduationThreshold, poolFee, tickSpacing, creatorTaxBps, buybackEnabled, phase, sweptQuote, sweptTokens, sweptAt, exists`. `phase`: 0 curve, 1 swept, 2 pool, 3 rescued.

Кривая: `getReserves()`, `realQuoteReserve()`, `graduationThreshold()`, `feeBps()`, `creatorTaxBps()`, `graduated()`, `readyToGraduate()`, `launchedAt()`, `pairToken()`.

Пара: `symbol()`, `decimals()` у `pairToken`; `address(0)` = нативный ETH.

---

## 3. Архитектура

```
                      ┌───────────────────────────────────────────┐
  Chainstack WSS ───▶ │  ingest                                   │
  Chainstack HTTPS ─▶ │   launches · curveTrades · lifecycle ·    │
  public RPC (fb) ──▶ │   poolSwaps · enrich · pairs · backfill   │
                      └───────────────┬───────────────────────────┘
                                      ▼
                            SQLite (WAL) — сырые события + метаданные
                                      ▼
                      ┌───────────────────────────────────────────┐
                      │  analyze  (тик каждые 30 с)               │
                      │   tokenize → cluster → heat → status →    │
                      │   flow edges → snapshots                  │
                      └───────────────┬───────────────────────────┘
                                      ▼
                     ┌────────────┬───────────────┬──────────────┐
                     │  CLI       │  HTTP API     │  SSE stream  │
                     │  narra *    │  /api/*       │  /api/stream │
                     └────────────┴───────────────┴──────────────┘
```

Один бинарь `narra`. Режимы:

- `narra serve` — индексер + анализатор + API. Долгоживущий процесс на VPS.
- `narra now|coin|flow|why` — клиент. Если рядом есть локальная БД, читает её; иначе ходит в `NARRA_API_URL`. Тем самым пользователь репо может крутить свою ноду, а сайт ходит в нашу.
- `narra watch` — подписка на `GET /api/stream` или на локальный analyzer.
- `narra doctor` — проверка RPC, chainId, констант, состояния БД, лага индексера.

Стек: Node 22 LTS, TypeScript, `viem` как библиотека для ABI/кодирования/RPC-транспорта (использовать библиотеку — не значит заимствовать чужой код), `better-sqlite3`, `hono` для HTTP, `zod` для схем ответов. Никаких ORM. Тесты: `node:test`.

Каталог:

```
narra/
  bin/narra.ts
  src/
    chain/        constants.ts · abi.ts · rpc.ts · multicall.ts
    ingest/       launches.ts · curveTrades.ts · lifecycle.ts · poolSwaps.ts · enrich.ts · pairs.ts · backfill.ts · watchdog.ts
    db/           schema.sql · db.ts · migrations/
    analyze/      tokenize.ts · dictionary.ts · cluster.ts · heat.ts · status.ts · flow.ts · verdict.ts · snapshot.ts
    api/          server.ts · routes/*.ts · sse.ts · holders.ts
    cli/          now.ts · coin.ts · flow.ts · why.ts · watch.ts · doctor.ts · render.ts
    config.ts
  docs/           STRATEGY.md · SAFETY.md · ARCHITECTURE.md · PONS.md · API.md
  test/
  data/           narra.db (gitignore)
```

---

## 4. RPC-слой (`src/chain/rpc.ts`)

Собственная реализация, требования:

1. Список эндпоинтов из `NARRA_RPC_URLS` (через запятую, приоритет по порядку). У каждого флаги: `logs` (можно `eth_getLogs`), `archive`, `ws`. Chainstack первый со всеми флагами, публичный RH второй с `logs=true, archive=false`.
2. Один запрос — один HTTP-вызов. JSON-RPC batch не использовать: публичный узел считает каждый элемент батча и режет.
3. Ограничение параллельности (`NARRA_RPC_CONCURRENCY`, по умолчанию 6 на Chainstack, 2 на публичном) и минимальный интервал между `eth_getLogs`.
4. На `429`/`503` — эндпоинт в штрафную на 5 с, запрос уходит на следующий. На Cloudflare-челлендж (HTTP 403 с HTML) — штраф 60 с.
5. Ошибка JSON-RPC с кодом отдаётся наверх как есть, чтобы отличать revert от лимита.
6. Метрики: число вызовов по методу, число 429, текущий лаг по блокам. Отдаются в `/api/health`.
7. WSS: `eth_subscribe("logs", {address|topics})` с ре-коннектом и пингом. Если 45 с нет ни одного лога по фабрике (цепь печатает запуск каждые несколько секунд) — переподписка и параллельный поллинг блочных диапазонов до восстановления.

---

## 5. Ingest

### 5.1 Общие правила

- Курсор на поток: таблица `cursors(stream, last_block, last_block_hash)`. Каждый поток идёт независимо.
- Диапазон бэкфила: `eth_getLogs` чанками по 2 000 блоков (~3.5 мин цепи). Для топика `CurveBuy` без адреса это ~1 600 логов на чанк, проверено на публичном узле.
- Дедупликация по `(tx_hash, log_index)` — UNIQUE в таблице.
- Реорги: Arbitrum-стек, глубокие реорги редкость. Правило: живой поток отстаёт от head на 2 блока; раз в минуту перечитываются последние 50 блоков и сверяются block_hash; при расхождении события этих блоков удаляются и перечитываются.
- Время: `block_timestamp` берётся из `eth_getBlockByNumber` с кэшем; для агрегатов используется время блока, не локальные часы.

### 5.2 Потоки

| Поток | Источник | Что пишет |
|---|---|---|
| `launches` | factory `TokenLaunched` | строка в `launches`, задача на enrich |
| `curve_trades` | топик `CurveBuy` / `CurveSell` без адреса | строка в `curve_trades`; неизвестная кривая → отложенный резолв через `launches` |
| `lifecycle` | factory `LaunchSwept`, `PoolGraduated` | обновление `launches.phase`, `swept_at`, `graduated_at`, `position_id` |
| `pool_init` | PoolManager `Initialize` | строка в `pools` с `pool_id, currency0, currency1, fee, tick_spacing, hooks`; связывается с токеном по адресу валюты |
| `pool_swaps` | PoolManager `Swap`, только для `pool_id` из `pools`, связанных с Pons-токенами | строка в `pool_swaps` |
| `enrich` | Multicall3: token meta + factory record + curve state | `tokens`, обновление `launches` |
| `pairs` | `symbol()`, `decimals()` у `pairToken` | `pairs` (кэш навсегда) |
| `curve_state` | периодический опрос кривых, у которых были сделки за 15 мин | `curve_snapshots(token, block, real_quote, progress)` |

### 5.3 Атрибуция кошелька

- На кривой: `recipient` из `CurveBuy` — это кошелёк, который получил токены. `buyer` может быть роутером. Для overlap используется `recipient`.
- В пуле: `Swap.sender` — это UniversalRouter, не человек. Кошелёк берётся из `tx.from` транзакции (`eth_getTransactionByHash`, кэш по хэшу). Объём свопов в пулах на два порядка меньше объёма на кривых (~560 градуаций в сутки), это дёшево. Альтернатива на будущее: `Transfer` токена с контрагентом PoolManager.

### 5.4 Нормализация quote

Пары бывают трёх видов: нативный ETH (`address(0)`), стейбл (USDG, USDC), токенизированная акция (NVDA, HOOD, …). Хранится сырое `quote_raw` + `pair_address`. Для тепла кластера вычисляется `quote_norm`:

- ETH → в ETH.
- Стейбл → в USD, затем в ETH по курсу ETH/USD (источник: цена ETH из DexScreener по WETH-паре на цепи, обновление раз в 5 минут, при недоступности последний известный курс с пометкой `stale`).
- Акция → в ETH через DexScreener-цену акционного токена, если есть; если нет — `quote_norm = NULL`, кластер помечается `pair-only`, и его тепло считается по числу покупателей и CA, не по объёму.

В API всегда отдаются оба значения: сырое в единицах пары и нормализованное.

---

## 6. Схема БД (SQLite, WAL)

```sql
launches(token PK, curve UNIQUE, deployer, pair_address, launch_config_id, graduation_threshold,
         block, tx_hash, log_index, ts, phase INT, swept_at, graduated_at, position_id, pool_id)
tokens(token PK, name, symbol, description, logo, twitter, telegram, discord, website, farcaster,
       creator_fee_recipient, creator_tax_bps, buyback_enabled, dev_buy_raw, enriched_at)
pairs(address PK, symbol, decimals, kind TEXT)         -- kind: eth | stable | stock | other
curve_trades(tx_hash, log_index, PRIMARY KEY(tx_hash, log_index), block, ts, curve, token, side,
             buyer, recipient, quote_raw, tokens_raw, fee_raw, tax_raw, quote_norm REAL)
curve_snapshots(token, block, ts, real_quote_raw, progress REAL, PRIMARY KEY(token, block))
pools(pool_id PK, token, currency0, currency1, fee, tick_spacing, hooks, init_block)
pool_swaps(tx_hash, log_index, PRIMARY KEY(tx_hash, log_index), block, ts, pool_id, token, wallet,
           side, quote_raw, tokens_raw, quote_norm REAL, sqrt_price)
cursors(stream PK, last_block, last_block_hash)

-- аналитика
clusters(id PK, slug UNIQUE, label, tags_json, created_at, last_seen_at, alive INT)
cluster_members(cluster_id, token, score REAL, reasons_json, PRIMARY KEY(cluster_id, token))
cluster_snapshots(cluster_id, window TEXT, ts, n_launches, n_alive, quote_norm_in, unique_buyers,
                  n_graduated, taxed_ratio, pool_volume_norm, status TEXT, PRIMARY KEY(cluster_id, window, ts))
flow_edges(from_cluster, to_cluster, window, ts, wallets INT, quote_norm REAL, deployers INT, PRIMARY KEY(from_cluster, to_cluster, window, ts))
verdicts(token, ts, verdict TEXT, cluster_id, score REAL, reasons_json, PRIMARY KEY(token, ts))
```

Индексы: `curve_trades(ts)`, `curve_trades(token, ts)`, `curve_trades(recipient, ts)`, `pool_swaps(ts)`, `pool_swaps(wallet, ts)`, `launches(ts)`, `launches(deployer, ts)`, `tokens(symbol)`.

Ретеншн: сырые `curve_trades` старше 14 дней сворачиваются в почасовые агрегаты и удаляются. Снапшоты кластеров хранятся бессрочно (это и есть «история 7 дней» за холд).

Оценка объёма: ~700k покупок в сутки × ~200 байт ≈ 150 МБ/сутки сырых данных, 2 ГБ за 14 дней. Нормально для SQLite на VPS с NVMe.

---

## 7. Analyze

Тик каждые 30 с. Окна: `15m`, `60m`, `4h`. Каждый тик пересчитывает все три окна и пишет `cluster_snapshots`.

### 7.1 Токенизация имени (`tokenize.ts`)

Вход: `name`, `symbol`, `description`. Выход: множество тегов.

1. Нижний регистр, снятие `$`, эмодзи, пунктуации. CamelCase и цифры разбиваются (`HoodRat2` → `hood`, `rat`, `2`).
2. Стоп-слова: `the, coin, token, on, robinhood, chain, meme, ai, official, inu, 2, v2, x` и т.п. Список в `dictionary.ts`, пополняется.
3. Синонимы и нормализация: `hood, robinhood → hood`; `grok, grokk → grok`; `tsla, tesla → tsla`. Словарь в файле, открытый в репо.
4. Пара добавляет структурный тег: `pair:eth`, `pair:usdg`, `pair:nvda`.
5. Описание весит меньше имени и тикера: тег из описания получает вес 0.4, из имени 1.0, из тикера 1.2.

### 7.2 Кластеризация (`cluster.ts`)

Работает на окне `60m` (базовое), `15m` и `4h` — проекции того же членства с пересчитанным теплом.

1. Кандидаты: все запуски за окно + все токены, у которых были сделки (кривая или пул) за окно. Второе условие важно: токен, запущенный 6 часов назад и торгующийся в пуле, остаётся в мете.
2. Матрица «тег → токены». Тег значимый, если у него ≥ 3 токенов за окно.
3. Связь двух токенов: взвешенное Жаккар-пересечение тегов ≥ 0.35 **или** пересечение покупателей ≥ 5 кошельков (по `recipient` на кривой и `wallet` в пуле) **или** общий деплоер + хотя бы один общий тег.
4. Компоненты связности → кластеры. Кластер из < 3 токенов не публикуется (токены получают `ORPHAN`).
5. Имя кластера: два тега с наибольшим суммарным весом, через дефис: `stock-hood`, `agent-grok`. Слаг стабильный: при следующем тике кластер сопоставляется с прошлым по пересечению членов ≥ 50% и наследует `id` и `slug`, даже если топ-теги слегка сдвинулись. Если совпадения нет — новый кластер.
6. `cluster_members.score` — доля связей токена внутри кластера к его связям вообще (0..1). Это и есть число `IN 0.81` на карточке.

### 7.3 Тепло и статус (`heat.ts`, `status.ts`)

На кластер и окно:

| Метрика | Источник |
|---|---|
| `n_launches` | `launches` за окно |
| `n_alive` | токены кластера с хотя бы одной покупкой за последние 15 мин |
| `quote_norm_in` | сумма `quote_norm` покупок на кривых + покупок в пулах за окно |
| `unique_buyers` | уникальные `recipient` + `wallet` за окно |
| `n_graduated` | `PoolGraduated` за окно среди членов |
| `taxed_ratio` | доля покупок с `tax_raw > 0` (боты в первые 3 с) |
| `pool_volume_norm` | объём свопов в пулах членов за окно |
| `delta` | изменение `quote_norm_in` против предыдущего равного окна |

Статусы (пороги в `config.ts`, стартовые значения ниже, **калибруются на неделе данных до запуска**):

| Статус | Правило |
|---|---|
| `HOT` | `n_launches ≥ 8` и `quote_norm_in ≥ 1.5 ETH` и `n_graduated ≥ 1` за 60m |
| `EMERGING` | `n_launches < 8`, но `delta ≥ +100%` и `unique_buyers ≥ 30` |
| `ROTATING IN` | `HOT` или `EMERGING` и есть входящее ребро потока с `wallets ≥ 8` |
| `ROTATING OUT` | есть исходящее ребро с `wallets ≥ 8`, а `delta < 0` |
| `COOLING` | `n_launches ≥ 8`, но `quote_norm_in < 0.5 ETH` и `delta < −50%` |
| `DEAD` | `n_alive = 0` при `n_launches ≥ 3` |
| `SOCIAL ONLY` | зарезервировано под модуль NOISE, в день 0 не выставляется |
| `CHAIN ONLY` | то же |

Приоритет при конфликте: `DEAD > ROTATING OUT > ROTATING IN > HOT > EMERGING > COOLING`.

### 7.4 Поток между кластерами (`flow.ts`)

Три вида рёбер, каждое считается отдельно и складывается в `flow_edges`:

1. **Повторные покупатели.** Кошелёк «сидит» в кластере A, если купил ≥ 2 разных токена A за окно W. Ребро A→B: число таких кошельков, купивших ≥ 1 токен B в следующем окне той же длины, и сумма их `quote_norm` в B.
2. **Деплоеры.** Деплоер, запустивший ≥ 2 токена A за W и ≥ 1 токен B за следующее W.
3. **Смена пары.** Если доля запусков с `pair:*` кластера сменилась (например, из ETH в HOOD-пары), это ребро A→A' с пометкой `pair-shift`. Показывается как атрибут кластера, не как отдельный кластер.

Ребро публикуется при `wallets ≥ 5` или `deployers ≥ 2`.

### 7.5 Вердикт по токену (`verdict.ts`)

`narra coin <CA>`:

1. Если токена нет в `launches` — попытка `getLaunchedToken(CA)`; если `exists = false` → ответ `NOT_PONS`.
2. Если нет в БД, но есть на цепи — синхронный enrich и подсчёт по последним 60 минутам его сделок.
3. Теги токена сравниваются со всеми живыми кластерами: `text_score` = взвешенный Жаккар с тегами кластера.
4. `wallet_score` = доля ранних покупателей токена (первые 100 покупок или первые 30 мин), которые за последний час покупали другие токены кластера.
5. `membership = 0.5·text_score + 0.5·wallet_score` для каждого кластера; берётся лучший.
6. Вердикт:

| Вердикт | Условие |
|---|---|
| `IN` | лучший кластер имеет статус `HOT`/`EMERGING`/`ROTATING IN` и `membership ≥ 0.5` |
| `EDGE` | лучший кластер живой, `0.25 ≤ membership < 0.5` |
| `OUT` | лучший кластер `COOLING`/`DEAD`/`ROTATING OUT` или ≥ 30% ранних покупателей за последние 10 мин купили токены другого кластера |
| `ORPHAN` | `membership < 0.25` для всех кластеров |
| `NOISE` | зарезервировано под соцсигнал; в день 0 не выставляется |

7. Причины — список строк с числами, каждая формируется шаблоном из данных:
   - `ticker HOOD matches cluster tag hood`
   - `14/31 early buyers also bought $HOODAI, $HOODX in last 40m`
   - `cluster stock-hood is HOT: 18 CA, 2.4 ETH in, 3 graduations / 60m`
   - `phase: pool (graduated 2h ago), 0.6 ETH pool volume / 60m`
   - `watch: 6 early buyers bought $ASTRA* in last 10m → ROTATING OUT risk`
8. Ответ кэшируется на 30 с.

---

## 8. Отслеживание меты после миграции в Uniswap v4

Ответ: да, отслеживается. Мета не заканчивается на градуации, потому что капитал горячей меты как раз уходит из кривых в пулы первых градуировавших токенов.

Как это устроено:

1. `PoolGraduated(token, positionId, …)` переводит запуск в `phase = 2`.
2. Пул находится по событию `Initialize` на PoolManager: `currency0`/`currency1` содержат адрес токена и адрес пары (`address(0)` для ETH), `hooks` равен `memeHook`. Дополнительная проверка: `pool_id = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`, где `fee` и `tickSpacing` из `getLaunchedToken`. Две дороги должны сойтись, иначе пул помечается `unverified`.
3. Дальше все `Swap` по этому `pool_id` пишутся в `pool_swaps`. Сторона определяется знаком `amount` у валюты токена: токен уходит из пула → покупка.
4. Кошелёк = `tx.from`. Объём нормализуется как в §5.4.
5. В тепле кластера объём пула складывается с объёмом кривых. Уникальные покупатели считаются по объединению `recipient` (кривая) и `wallet` (пул).
6. Токен в пуле остаётся членом кластера, пока по нему есть сделки за окно. Карточка `narra coin` показывает `phase: pool`, время градуации и объём пула.
7. Отдельная метрика кластера `graduated_share` = доля членов в фазе пула. Высокая доля при падающем объёме кривых — признак, что мета «созрела» и новые запуски в неё уже опаздывают. Это отдельная причина в вердикте `EDGE`/`OUT`.

Ограничения:

- Между `LaunchSwept` и `PoolGraduated` есть пауза от секунд до минут, когда токен не торгуется нигде. В этот момент фаза `swept`, объём нулевой, токен не выпадает из кластера.
- Свопы через агрегаторы или напрямую через PoolManager без UniversalRouter всё равно попадают в `Swap`; `tx.from` тогда может быть контрактом. Такие кошельки помечаются `contract` (по `eth_getCode`, кэш) и в overlap не участвуют.
- USD-цена пула не нужна для меты; для отображения берётся DexScreener (`/latest/dex/tokens/{token}`) с кэшем 60 с и пометкой источника.

---

## 9. HTTP API

Базовый путь `/api`. Все ответы JSON, `zod`-схемы в `src/api/schemas.ts`, они же экспортируются для фронтенда. Ошибки: `{ error: { code, message } }`.

| Метод | Путь | Ответ | Гейт |
|---|---|---|---|
| GET | `/health` | лаг индексера, head, состояние RPC, время последнего тика | нет |
| GET | `/board?window=60m&pair=all` | `{ ts, window, clusters: Cluster[] }`, отсортировано `HOT → EMERGING → ROTATING → COOLING → DEAD` | нет для 60m; `15m` и `4h` — холд |
| GET | `/cluster/:slug?window=60m` | `Cluster` + `members: Member[]` + `edges_in/out` + `tags` с весами | нет |
| GET | `/coin/:ca` | `Verdict` | нет |
| GET | `/flow?window=60m` | `{ nodes, edges }` | холд |
| GET | `/history/cluster/:slug?days=7` | снапшоты по 15 мин | холд |
| GET | `/stream` | SSE: `launch`, `cluster_status`, `edge`, `graduation`, `verdict` | холд (публично — с задержкой 5 мин) |
| POST | `/holders/check` | `{ address }` → `{ balance, threshold, ok }` | нет |
| GET | `/og/cluster/:slug.png`, `/og/coin/:ca.png` | PNG-карточка для превью в X (см. FRONTEND) | нет |

Типы:

```ts
Cluster = { id, slug, label, status, window, n_launches, n_alive, quote_norm_in, quote_unit: "ETH",
            unique_buyers, n_graduated, graduated_share, taxed_ratio, pool_volume_norm, delta_pct,
            pair_mix: { eth, stable, stock }, top_tags: [{tag, weight}], rotating_from?: slug, rotating_to?: slug }
Member  = { token, symbol, name, phase: "curve"|"swept"|"pool", progress, membership, verdict, buyers_overlap, last_trade_ts }
Verdict = { token, symbol, name, phase, verdict, cluster?: { slug, status, membership }, alternatives: [{slug, membership}],
            reasons: string[], watch: string[], computed_at, sources: { launch_tx, block } }
```

Холдер-гейт: `POST /holders/check` читает `balanceOf(address)` у контракта `$META` (адрес в `NARRA_TOKEN_ADDRESS`, пустой до запуска — тогда все эндпоинты открыты). Ответ подписывается коротким HMAC-токеном на 24 ч, который фронт кладёт в cookie и присылает в заголовке `x-narra-holder`. Никакой подписи кошельком, никаких `personal_sign`. Порог `NARRA_HOLDER_THRESHOLD` в токенах.

Лимиты: 60 запросов/мин на IP без гейта, 600 с гейтом. SSE — 1 соединение на IP без гейта.

CORS: только домен сайта.

---

## 10. CLI

```
narra doctor                       # RPC, chainId, константы, лаг, размер БД
narra serve [--port 4663]          # индексер + анализатор + API
narra now [--window 60m] [--pair eth|usdg|stock|all] [--json]
narra coin <CA> [--json]
narra flow [--window 60m] [--json]
narra why <cluster-slug> [--json]
narra watch [--json]               # лента событий, без TUI в день 0
narra backfill --hours 24          # ручной бэкфил
```

Вывод `narra now` (человекочитаемый):

```
META  12:04:11 UTC   window 60m   pair all   lag 2 blocks   source chainstack

HOT          stock-hood     18 CA   2.41 ETH   3 grad   31% pool   ← agent-grok (11 w)
EMERGING     astra-hands     7 CA   0.83 ETH   0 grad    0% pool
COOLING      frog-exit      22 CA   0.19 ETH   0 grad    5% pool   → stock-hood (9 w)
DEAD         office-bot     11 CA   0.00 ETH   0 grad    0% pool
```

`--json` печатает ровно то, что отдаёт API, одна строка на объект в `watch`.

Без TUI на день 0. Полноэкранный терминал — после CA, если будет спрос.

---

## 11. Конфигурация

```
NARRA_RPC_URLS=https://<chainstack>.com/<key>,https://rpc.mainnet.chain.robinhood.com#nologs-archive
NARRA_WS_URL=wss://<chainstack>.com/ws/<key>
NARRA_DB_PATH=./data/narra.db
NARRA_API_PORT=4663
NARRA_API_ORIGIN=https://narra.example
NARRA_TOKEN_ADDRESS=            # пусто до запуска
NARRA_HOLDER_THRESHOLD=500000
NARRA_HOLDER_SECRET=            # HMAC
NARRA_BACKFILL_HOURS=24
NARRA_ANALYZE_INTERVAL_S=30
NARRA_DEXSCREENER=on
```

Пороги статусов и веса токенизации — в `config.ts`, не в env, с комментарием «откалибровано на данных за <дата>».

---

## 12. Эксплуатация

- Один VPS (4 vCPU, 8 ГБ, NVMe) в Европе. Docker-образ, `docker compose` с одним сервисом и volume для `data/`.
- Бэкап `narra.db` раз в час через `sqlite3 .backup` в объектное хранилище, хранить 7 суток.
- Логи структурированные JSON в stdout. Уровни: `info` для тиков анализа и статусов, `warn` для 429 и переподписок, `error` для расхождений констант.
- `/api/health` возвращает `503`, если лаг > 300 блоков или последний тик анализа старше 3 минут. Внешний uptime-пинг раз в минуту.
- Сайт не должен ломаться, если бэкенд лежит: см. FRONTEND, баннер `stale`.

Бюджет RPC при Chainstack: подписки на два адреса и два топика + ~2 `eth_getLogs`/мин на верификацию реоргов + multicall на каждый запуск (~1 вызов/4 с) + `eth_getTransactionByHash` на свопы в пулах (~1 вызов/2 мин). Это единицы миллионов вызовов в месяц, укладывается в базовый платный план.

---

## 13. Тесты

- `tokenize`: фикстуры из 200 реальных имён с ожидаемыми тегами.
- `cluster`: синтетический набор из 40 токенов с известными компонентами; проверка стабильности `slug` между тиками.
- `status`: таблица порогов → ожидаемый статус.
- `flow`: две волны кошельков → одно ребро с правильным весом.
- `verdict`: токен с известным overlap → `IN` с ожидаемыми причинами.
- `decode`: разбор логов `TokenLaunched`, `CurveBuy`, `Swap` из записанных сырых JSON.
- Replay-тест: 3 000 блоков реальных логов, записанных в `test/fixtures/`, прогоняются через ingest + analyze; проверяется, что доска воспроизводится детерминированно.

Тесты не ходят в сеть.

---

## 14. Что открыто в репо, что нет

Открыто (MIT): весь `src/`, словарь тегов, пороги, формулы, `docs/STRATEGY.md` с описанием §7, `docs/PONS.md` с §2.

Не в репо: наша БД с историей, конфиг с ключом Chainstack, Telegram-алерты (после CA), словарь, обкатанный на нашей истории (публикуется базовая версия).

---

## 15. Этапы

**Неделя −1 (до CA)**
1. RPC-слой, схема БД, ingest трёх потоков с кривых и фабрики, бэкфил 24 ч.
2. Enrich и пары. `narra doctor`.
3. Токенизация и кластеризация на живых данных, первые слаги.
4. Тепло, статусы, снапшоты. Калибровка порогов на 3–5 днях данных.
5. Поток повторных покупателей. `narra now`, `narra coin`, `narra why`, `--json`.
6. API + SSE. Деплой на VPS. Фронтенд подключается.
7. Пулы v4: `Initialize`, `Swap`, атрибуция. `graduated_share`.

**День 0 (обязательное)**
Пункты 1–6. Пул v4 желателен, но доска честно работает и без него: тогда токены после градуации помечаются `pool (volume n/a)`.

**День +1…+7**
Холдер-гейт, история 7 дней, `/flow` на сайте, Telegram-алерты смены статуса, OG-карточки, модуль NOISE как четвёртый сигнал.

---

## 16. Открытые вопросы к калибровке

1. Реальные пороги `HOT`/`COOLING` — только по неделе снапшотов.
2. Нужны ли отдельные пороги для стейбл- и акционных пар, где объёмы другие.
3. Сколько тегов давать описанию: возможно, описание только шумит и его вес стоит обнулить.
4. Дневная сезонность: ночью по UTC волны тише, статусы могут «остывать» просто от времени суток. Вариант: сравнивать с тем же часом вчера.
