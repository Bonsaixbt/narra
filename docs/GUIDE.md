# narra — гайд пользователя

narra отвечает на три вопроса про Pons v2 на Robinhood Chain: какая мета печатает прямо сейчас, куда перетекает капитал и в какую мету попадает конкретный токен. Всё считается на твоей машине из событий цепи. Ничего не подписывает, ключей не просит.

`IN` означает «токен принадлежит живой мете». Это не рекомендация. Меты на этой цепи умирают за минуты.

---

## 1. Установка и первый запуск

```sh
cd ~/Desktop/bonsai
npm install
npm run build && npm link        # команда narra появляется в любой папке
narra doctor                     # проверка узла, констант Pons и кэша
```

`.env` в папке проекта или `~/.narra/.env`:

```
NARRA_RPC_URL=https://твой-узел/ключ,https://rpc.mainnet.chain.robinhood.com
NARRA_WS_URL=wss://твой-узел/ws/ключ
```

Без своего узла тоже работает, на публичных RPC, только медленнее: первый час данных около двух минут.

Кэш лежит в `~/.narra/narra.db`. Первый запуск любой команды докачивает недостающее окно, дальше каждая команда догоняет цепь за секунды.

---

## 2. Полный экран: `narra terminal`

```sh
narra terminal                   # окно 60m по умолчанию
narra terminal --window 15m      # быстрее и острее
```

Экран:

```
 NARRA terminal  15:37 UTC  window 60m  ok · head 62064460 · 106 metas   websocket
 ───────────────────────────────────────────────────────────────────────────────────────
 hottest ponsora-cult 231.4 ETH · 1985 buyers   draining fort-sol 225 wallets left
 narratives mixed 52% · animals 22% · chinese 10%   106 metas · 1059 ETH

 #  status        meta                  narrative        CA   ETH in         buyers  flow │ ponsora-cult  ROTATING IN  mixed
› 1 ROTATING IN   ponsora-cult          mixed             7   231.4 ██████    1985  ⇦21   │ 7 CA · 9 members · 9 alive · 231 ETH · 1985 buyers
  2 ROTATING IN   cat-fart              animals          36    93.9 ██░░░░    1005  ⇦51   │ links name 0 · semantic 0 · wallet 10 · deployer 0
  3 ROTATING IN   rat-rotating          animals           4    52.3 █░░░░░     628  ⇦15   │ cohorts snipers 10 · rotators 11 · early-in-hot 7
  …                                                                                        │   0xefe9…52a4 $MATIUM   curve 0.52   7 ovl  26s ago
 ───────────────────────────────────────────────────────────────────────────────────────
 15:37:33 LAUNCH  0x8650…8b44  $FLYNODE  unclustered
 15:37:33 STATUS  suica  EMERGING → HOT  8 CA · 20.6 ETH · 287 buyers
 ↑↓ move · enter open · c contract · f flow · W wallets · w window · r refresh · ? help · q quit
```

- Слева доска, ранжированная: сначала ROTATING IN и HOT, потом EMERGING, дальше остывающие.
- Справа выбранная мета: числа, чем она склеена, когорты кошельков, приток и отток, члены.
- Внизу живая лента: новые запуски, смена статусов, новые рёбра потока, градуации. Сокет будит обновление через секунды после события.

Клавиши:

| Клавиша | Действие |
|---|---|
| `↑` `↓` или `j` `k` | выбрать мету |
| `enter` или `l` | открыть мету на весь экран |
| `b` или `esc` | назад на доску |
| `c` | вставить адрес контракта → карточка |
| `f` | поток капитала между метами |
| `W` | кошельки с когортами |
| `w` | переключить окно 15m → 60m → 4h |
| `r` | обновить сейчас |
| `?` | помощь |
| `q` | выход |

---

## 3. Проверить свой токен

В полном экране: `c`, вставить адрес, `enter`. В обычном терминале:

```sh
narra coin 0xАДРЕС
narra coin 0xАДРЕС --window 4h        # шире окно, больше контекста
narra coin 0xА 0xБ 0xВ                 # несколько сразу
echo 0xАДРЕС | narra coin -            # из stdin
```

Карточка:

```
$Roblonks · Roblonks · 0xac42…ee8f
phase curve 0.01/4.2 ETH · launched 11m ago · pair ETH

OUT     cat-fart   0.52   (cluster ROTATING IN)
alt     cheese-rotating   0.51
popular meta #2 of 107 on the board · joins it by wallets · 814 buyers, more than 99% of tokens

reasons
  74/100 early buyers also bought $POWER, $cheese in this window
  7 rotators and 71 early-in-hot wallets among its 100 early buyers
  cluster cat-fart is ROTATING IN: 36 CA, 94.02 ETH in, 1 graduations in window
  41% of early buyers already moved to goatsen
watch
  41 of 100 early buyers bought goatsen in the last 10m → rotating out risk
```

Как читать:

| Строка | Смысл |
|---|---|
| `phase` | `curve` ещё на кривой с прогрессом до 4.2 ETH; `swept` пауза перед пулом; `pool` уже в Uniswap v4 |
| вердикт | `IN` в живой мете; `EDGE` имя подходит, капитала мало; `OUT` мета остывает или покупатели ушли; `ORPHAN` ни к чему не липнет; `NOT_PONS` это не запуск Pons v2 |
| число после меты | membership 0..1: половина текст, половина пересечение ранних покупателей |
| `alt` | другие меты, к которым токен близок |
| `popular` | ранг меты на доске, ранг токена внутри меты по покупателям, доля токенов окна, у которых покупателей меньше |
| `reasons` | каждая строка выведена из чисел: пересечения кошельков, когорты, состояние меты |
| `watch` | риски: уход ранних покупателей в другую мету, снайперы, деплоер-ферма |

Коды выхода с `--quiet` для скриптов: 0 IN, 1 EDGE, 2 OUT, 3 ORPHAN, 4 NOT_PONS.

---

## 4. Доска: `narra now`

```sh
narra now                        # топ-15, DEAD скрыты
narra now --window 4h
narra now --all                  # все меты
narra now --top 40
narra now --pair stock           # только меты с акционными парами
narra now --members              # с членами под каждой метой
```

Первые строки это ответ: сколько мет в каких статусах, сколько ETH и покупателей, самая горячая мета, откуда утекает капитал и в сколько мет, доли нарративов. Ниже таблица.

Статусы:

| Статус | Что произошло |
|---|---|
| `HOT` | много запусков, много ETH, есть градуации |
| `EMERGING` | запусков ещё мало, но деньги и покупатели растут |
| `ROTATING IN` | кошельки из других мет покупают сюда |
| `ROTATING OUT` | те же кошельки уже покупают соседей |
| `COOLING` | запусков много, денег мало, падает |
| `DEAD` | имена печатаются, сделок нет |

Колонки: `CA` запусков в окне, `ETH in` ETH в кривые и пулы, `grad` градуаций, `buyers` уникальных покупателей, `flow` ⇦ пришедших и ⇨ ушедших кошельков, стрелка со слагом откуда или куда.

Нарратив рядом со слагом: `chinese`, `animals`, `stocks`, `robinhood`, `ai-agents`, `politics`, `crypto`, `tools`, `celebrities`, `money`, `culture` или `mixed`. `chinese·animals` значит китайские имена с животной темой.

---

## 5. Найти и понять мету

```sh
narra find cat                   # по слову, тикеру, имени или началу адреса
narra find 0x9e02
narra why cat-fart               # точный слаг
narra why cheese                 # любое слово из имени, тегов или тикеров
```

`why` показывает: числа меты, чем она склеена (связи по имени, семантике, кошелькам, деплоеру), теги с примерами тикеров, приток и отток, членов с membership и пересечением покупателей. Если слово подходит нескольким метам, команда перечислит их.

---

## 6. Куда идёт капитал

```sh
narra flow                       # рёбра A → B за окно
narra flow --window 4h
```

Ребро значит: кошельки купили два и больше токена меты A в прошлом окне и купили мету B в этом. Рядом ETH, которые они занесли в B, и деплоеры, сменившие мету. Публикуются рёбра от 5 кошельков или от 2 деплоеров.

---

## 7. Кошельки

```sh
narra wallets                    # по net ETH, только покупавшие в окне
narra wallets --cohort rotator
narra wallets --cohort early-in-hot --sort tokens
narra wallets --all              # включая тех, кто только продавал
narra wallet 0xАДРЕС             # один кошелёк: когорты, позиции, вход после запуска
```

Когорты:

| Когорта | Правило |
|---|---|
| `sniper` | 3+ покупки и половина из них в первые 5 секунд после запуска |
| `sprayer` | больше токенов за окно, чем лимит 8 / 20 / 50 для 15m / 60m / 4h; не голосует в кластеризации |
| `rotator` | покупал в 3+ метах и net больше нуля |
| `early-in-hot` | 3+ покупки членов живых мет в первые 5 минут |

`net` это ETH на выходе минус на входе за окно. Оно не учитывает, что кошелёк ещё держит. Это поток, не PnL.

---

## 8. История

```sh
narra trend --hours 48 --step 4  # ETH за шаг, доли нарративов
narra history cat-fart --hours 6 # статусы меты по снапшотам
narra history 0xАДРЕС --hours 24 # почасовая активность токена
narra backfill --hours 72        # докачать историю
```

Сырые сделки хранятся 48 часов, старше сворачиваются в почасовые агрегаты, так что `trend` и `history` работают и на неделях.

---

## 9. Живая лента без полного экрана

```sh
narra watch
narra watch --only STATUS,EDGE
narra watch --jsonl | jq -r 'select(.type=="STATUS" and .to=="HOT") | .slug'
```

---

## 10. Для агентов и скриптов

Каждая команда принимает `--json`. `narra schema coin` печатает JSON Schema ответа.

MCP для Claude Code, Claude Desktop, Cursor, Codex:

```sh
claude mcp add narra -- narra mcp
```

Локальный HTTP на 127.0.0.1:

```sh
narra serve --port 4663
curl localhost:4663/coin/0xАДРЕС
curl localhost:4663/now?window=15m
```

---

## 11. Обслуживание

```sh
narra doctor                     # узел, константы, кэш, семантика
narra cache stats
narra cache normalize            # пересчитать ETH у сделок после глубокого бэкфила
narra cache vacuum               # сжать базу
narra cache clear                # начать с нуля
narra calibrate --window 60m --hours 168 --write   # пороги статусов из накопленных снапшотов
```

Снапшоты для калибровки копятся только пока работает `narra serve` или `narra watch`. Для постоянной работы есть юниты в `integrations/launchd/` и `integrations/systemd/`.

Семантический слой выключен по умолчанию. `NARRA_SEMANTIC=on` в `.env` включает локальные эмбеддинги, `NARRA_SEMANTIC_NAME=anthropic|openai` добавляет подписи мет через модель. Подробно в `.env.example`.

---

## 12. Как не обмануться

- Окно 15m острое и шумное, 60m основное, 4h показывает контекст, но крупные меты там сливаются.
- Мета с сотней покупателей и одним запуском это чаще один токен, вокруг которого пусто. Смотри `CA` и `members`.
- `deployer is a launch farm` в карточке значит, что автор печатает токены десятками. Такой токен может попасть в мету по кошелькам, но это не сигнал.
- Много снайперов среди ранних покупателей значит быстрый выход. Это написано в `watch`.
- Все пороги статусов пока стартовые, не откалиброванные. Числа в `reasons` точные, ярлыки статусов приблизительные.
