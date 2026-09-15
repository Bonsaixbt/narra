# Bonsai — content plan for the narra warm-up and launch

The account is @bonsaixbt on X. The product is narra: which meta is printing on Pons right now, whether a token belongs to it, and where the repeat buyers moved. Every post is made from the product's own output; nothing is promised that the numbers do not show.

## 0. The bridge: from the current feed to the warm-up (D−10 → D−6)

What the feed is on 2026-09-15: nine recent posts about AI tools with a punchline (Grok 5 and the $800 subscription, "if your feed is not about these AI guys", a fly playing poker, Elon and trained flies, "1980 Rubik's cube / 2026 GPT", a $100 bet on a generated boxing match, GPT Astra rebuilding a game from an ad); 600–2,700 views each; the pinned article on Karpathy and token savings at 1.4M views; bio "Creator | Video maker | Love playing with AI tools". The audience came for "AI does strange and impressive things"; it is not a crypto audience.

Rules of the bridge: the format stays (a quoted post or a short video plus a two-line punchline); only the subject changes — not Grok, but how AI and people guess metas. No "narra", no repo, no ticker of ours. The bridge goes through AI, not through memecoins: "I gave an agent a launchpad to watch" belongs in this feed, "buy $PONS" does not.

| Day | Post | Text |
|---|---|---|
| D−10 | M1 — the "1980 / 2026" format; image: the board with 71 metas in an hour, unlabeled | `2026: your AI agent solves a Rubik's cube, boxes, plays poker and codes a game from an ad.` / `Also 2026: 27,000 tokens launch on one chain in a day and not one agent can tell you which 40 of them belong together.` / `Pattern matching on cubes: solved. Pattern matching on wallets: nobody bothered.` |
| D−9 | M2 — quote a fresh Vlad Tenev or Robinhood post about Robinhood Chain (trending) | `Robinhood built a chain, $PONS built a launchpad on it, and degens are now launching a new token every 3 seconds on top of both.` / `The chain handles it fine. The humans reading the feed do not.` |
| D−8 | M3 — video: three models confidently call a token "the cat meta"; next to it the chain: 9 of its buyers among the meta's 403 | `Asked three AI models if a token was part of the cat meta.` / `All three said yes. All three quoted the same two tweets. The chain said the cat meta had 403 buyers that hour and this token had 9 of them.` / `The model read the timeline. Nobody read the wallets.` — the seed of P1 |
| D−7 | M4 — the "generated boxing match" format: a bet on something already decided | `You buy the token at 14:20 because the meta is "clearly heating up".` / `At 14:05, 480 wallets had already left it for the next one. Two buys in the old meta, one in the new, same wallets, on chain, public.` / `You did not lose to the market. You lost to a timestamp.` |
| D−6 | M5 — the first terminal frame, framed as one more AI experiment; `narra terminal` full screen, 20 s, no name on screen | `Gave an AI agent one job: watch a launchpad for an hour and group every launch into memes as they happen.` / `No tweets, no KOLs, no "sentiment". Just who is buying what and when.` / `It found 71 groups. Six were alive. One had 403 wallets in it. Tomorrow I show what it says about the one you are holding.` — from here the feed is about the tool |

Transition details: keep the Karpathy article pinned until D−1 (it is the one anchor on "tools for agents"); bio on D−3 becomes "Creator | Video maker | building a terminal that reads Robinhood Chain", the word narra enters the bio on D0; one off-topic AI video every two days at most, none about Elon; from D−10, short replies with one number from the terminal under other people's posts about Robinhood Chain and $PONS, no links — the cheapest audience for the warm-up. Numbers in the posts are from 2026-09-15; refresh them from the terminal before filming.

The owner's operative plan with the warm-up posts P0–P5 and the launch hour lives outside the repo; this file keeps the pillars, the calendar and the rules.

## 1. The three phases

| Phase | When | Goal | Cadence |
|---|---|---|---|
| Warm-up | now → token launch (target 10–14 days) | the audience learns what a meta is, sees the board every day, learns that `IN` means "belongs to a live meta" | 2 posts a day, 1 thread a week |
| Launch week | launch day → +7 | the token exists; every post links the site, the terminal and the bot; holder features are announced with a date, not switched on yet | 3 posts a day, live replies |
| Post-launch | +7 onward | the account becomes the daily source for Pons rotations; holder mode goes live; the terminal and MCP reach agent builders | 1–2 posts a day, 1 thread a week, 1 data note a month |

## 2. Content pillars (rotate through all five every week)

1. **The board, daily.** A screenshot or a 20-second recording of `narra now` or the site's board at a fixed time (choose one, e.g. 14:00 UTC). One sentence of the reading, no commentary beyond it. This is the habit post.
2. **One rotation, explained.** A flow edge from `/flow` with its moves: "13 wallets that were in `jbc-hodlegg` bought `stock-tokenized` inside the hour; 0.88 ETH". Screenshot of the site's flow page plus one transaction link. Weekly thread candidate.
3. **Is this CA in a meta?** Reply-driven: people paste a contract address, the answer is the coin card (`/coin/:ca`, the OG image renders itself). Rules: answer with the card and the reading only; never "buy" or "sell"; `IN` is membership, the card says so.
4. **How it works.** One mechanism per post: sprayer cap, why HOT needs ≥ 20 ETH this week, why a slug keeps its id, how flow history samples ticks. Source is `docs/STRATEGY.md`; every claim is reproducible from the public cache.
5. **Open source and agents.** `npm i -g narrahood`, the MCP server in Claude Desktop or Cursor, the JSON Schemas. Show an agent asking narra a question and getting a verdict. Builders are the long-tail audience.

## 3. Warm-up calendar (14 days)

| Day | Post |
|---|---|
| 1 | Board screenshot + "what a meta is" in two sentences. Pin it. |
| 2 | One rotation with its moves (site `/flow`). |
| 3 | Reply day: ask for CAs, answer with cards. |
| 4 | How it works: the sprayer cap ("a wallet that buys 20 tokens an hour does not vote"). |
| 5 | Board + the week's HOT count vs last week's. |
| 6 | Thread: the busiest hour of the week from flow history, edge by edge, with transactions. |
| 7 | Terminal recording: `narra terminal`, 30 s, no voice-over. |
| 8 | Board. |
| 9 | How it works: why a meta's id survives a slug change. |
| 10 | Rotation of the day. |
| 11 | Agent post: narra inside Claude Desktop via MCP, one question, one answer. |
| 12 | Board + narrative mix of the day (stocks vs animals vs robinhood). |
| 13 | Thread: "what `IN` means and what it does not" — the honesty post, with the ORPHAN and OUT examples. |
| 14 | Launch announcement: date, contract on Pons, what holders get and when (holder mode a few days later, by date). |

## 4. Launch week

- Day 0: contract address once, from the account, with the site link and the bot link; the coin card for `$NARRA` itself.
- Days 1–7: the board every day, one rotation every day, replies to every CA. One post on how the launch looked in narra's own numbers (buyers, wallet clusters, flow into the narra meta if one forms), honest even if it is unflattering.
- Holder mode: announced with a date on day 0, switched on by that date, first post shows the `4h` window and flow that anonymous viewers do not get.

## 5. Formats and assets

- Screenshots: site board and cards (dark theme, the OG image is already 1200×630 for X).
- Recordings: `narra terminal` full-screen, 20–30 s, `asciinema` or QuickTime; no voice-over, one caption.
- Threads: 5–8 posts, each with one image, the last one links the site and the repo.
- Replies: the coin card image plus its reading sentence.
- Everything in English. Numbers stay as the tool prints them (`23.58 ETH · 717 buyers`).

## 6. Rules

- No price talk, no "this will pump", no calls. `IN` = belongs to a live meta, not a recommendation, on every surface.
- Every number opens to its source: link the site page or the transaction.
- Post real output only; never a mock-up. If the board is quiet, post the quiet board ("no rotation above the threshold in the last hour").
- Answer CAs from anyone; ignore requests to rate a token.
- One voice: terse, factual, dry. The reading sentences the tool writes are the tone.

## 7. What to measure

| Metric | Where | Target by launch |
|---|---|---|
| Daily board post impressions | X analytics | growing week over week |
| CAs pasted per day | replies + bot `/coin` count (`/api/health` → `bot.sent`) | 20+ |
| Site visits per day | Cloudflare analytics on the Worker | 300+ |
| Bot group members | Telegram | 200+ |
| `npm` installs | npm stats after publish | any; builders are slow and loyal |

## 8. Production checklist (owner)

- `npm publish narrahood` before the agent post (day 11).
- A fixed daily time for the board post; the bot digest can be set to the same time.
- Preview cards checked on a real X post before day 1.
- `NARRA_TOKEN_ADDRESS` and the holder date decided before day 14.
