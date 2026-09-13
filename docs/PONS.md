# What narra reads from the chain

All facts here are public; `narra doctor` re-checks the live ones.

| | |
|---|---|
| Network | Robinhood Chain, chain id 4663, ~100 ms blocks, ETH gas |
| Default RPC | `wss://robinhood-rpc.publicnode.com` (subscriptions), `https://robinhood-rpc.publicnode.com` (`eth_call`), `https://rpc.mainnet.chain.robinhood.com` (`eth_getLogs`) |
| Pons v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Graduation (ETH pairs, config 0) | 4.2 ETH real quote; stable and stock pairs carry their own thresholds |
| Opening tax | 9 900 bps at t = 0, gone after 3 s |

## Events

```
factory   TokenLaunched(token, curve, deployer, pairToken, launchConfigId, graduationThreshold)
factory   LaunchSwept(token, quoteOut, tokenOut)
factory   PoolGraduated(token, positionId, tokenAmount, pairTokenAmount)
curve     CurveBuy(buyer, recipient, quoteIn, tokensOut, fee, tax)      -- topic filter only, all curves at once
curve     CurveSell(seller, recipient, tokensIn, quoteOut, fee, tax)
pool mgr  Initialize(id, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick)   -- hooks == factory.memeHook()
pool mgr  Swap(id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee)              -- positive amount = swapper receives
token     Transfer(from, to, value)                                                            -- wallet attribution for pool trades
```

`CurveBuy.recipient` is the wallet that received the tokens; `buyer` may be a router. narra keys everything on `recipient`.

## Reads

Per launch, one Multicall3 call: `name()`, `symbol()`, `getTokenInfo()` (logo, description, socials) on the token, `getLaunchedToken(token)` on the factory (creator fee recipient, creator tax, phase). Pair assets: `symbol()`, `decimals()` once, cached forever.

## Sync

One cursor. Chunks of 2 000 blocks; per chunk two `eth_getLogs` (factory, curve topics) and two block reads for timestamps. Trades on curves launched before the window are matched by querying `TokenLaunched` filtered on the curve topic, 40 curves per call, back to 600 000 blocks. A reorg deeper than the 2-block head lag is not handled in v0.1.

## Pools

A graduated token's pool is found by `Initialize` with the Pons hook and a currency equal to a cached launch. Swap side is the sign of the token amount (positive = the swapper received tokens = buy). The wallet is the end of the token `Transfer` chain that starts at the PoolManager (buys) or ends there (sells), skipping the hook's fee leg; when no chain is found, `Swap.sender` (a router) is recorded and counted as unattributed. A hot pool does several thousand swaps per half hour; per-transaction reads would not scale, log queries per chunk do.

## Public RPC limits, measured

- The official node answers 429 above a handful of concurrent calls, counts every entry of a JSON-RPC batch, and hands a Cloudflare challenge to noisy clients. narra sends single requests, keeps two in flight, spaces `eth_getLogs` by 250 ms, and benches an endpoint for 5 s after a refusal (60 s after a challenge).
- publicnode refuses `eth_getLogs` but is fast for state reads and runs a free websocket.
- A topic-only `eth_getLogs` for `CurveBuy` over 3 000 blocks returns ~2 400 logs in ~2 s.

Set `NARRA_RPC_URL=https://your-node,https://rpc.mainnet.chain.robinhood.com#nologs` (or `--rpc`) to put a private provider first.
