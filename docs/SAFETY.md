# Safety

## What narra never does

- Holds, asks for or reads a private key. There is no `--live`, no `buy`, no `sell`, no signing path in the code.
- Connects a wallet. The tool never touches `window.ethereum` or any wallet software.
- Sends anything but JSON-RPC to the RPC endpoints you configured, plus one request to a public ETH/USD price endpoint (`api.coinbase.com`) every five minutes for stable-pair normalisation. `NARRA_NO_USD=1` disables it.
- Runs a public server. `narra serve` binds `127.0.0.1` only.

## What it stores

`~/.narra/narra.db`: launches, token metadata, curve trades (48 h retention by default, `NARRA_RETENTION_H`), pool swaps, cluster snapshots. Delete it any time: `narra cache clear`.

## What the verdict means

`IN` means the token belongs to a cluster that is live right now, by names and by wallets. It does not mean the token will go up, that the cluster will stay live, or that anyone should enter. Metas on this chain die within minutes; a cache that is two blocks behind is already history. Read the reasons, check the sources, decide yourself.

## Known ways to be wrong

- A launch farm with 30 identically named tokens looks like a meta. `narra why` shows `same-deployer links` for that.
- A busy crowd of 200 wallets buying every third launch can chain unrelated groups together. Sprayer filtering and the two-pair merge rule limit this; they do not eliminate it.
- Timestamps are interpolated inside block chunks.
- Thresholds are uncalibrated starting values.
