#!/usr/bin/env sh
# narra + jq recipes. Every command prints stable JSON with --json / --jsonl.

# HOT clusters right now
narra now --json | jq -r '.clusters[] | select(.status=="HOT") | "\(.slug)\t\(.heat.n_launches) CA\t\(.heat.quote_norm_in) ETH"'

# verdict + reasons for one address
narra coin 0x2f817ab90dbfd772dfb0c2039ef8f53126441f7b --json | jq '{verdict, cluster: .cluster.slug, status: .cluster.status, reasons}'

# exit code as the answer (0 IN · 1 EDGE · 2 OUT · 3 ORPHAN · 4 NOT_PONS)
if narra coin "$CA" --quiet; then echo "in a live meta"; else echo "not in a live meta ($?)"; fi

# many addresses from a file
narra coin - < addresses.txt --jsonl | jq -r '"\(.verdict)\t\(.symbol)\t\(.cluster.slug // "-")"'

# live: only status changes to HOT
narra watch --jsonl --only STATUS | jq -r 'select(.to=="HOT") | "\(.ts) \(.slug) is HOT"'

# flow table, biggest edges first
narra flow --json | jq -r '.edges[] | "\(.from) -> \(.to)\t\(.wallets) wallets\t\(.quote_norm) ETH"'
