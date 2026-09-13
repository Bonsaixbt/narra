# Deploying the service on a VPS

One box (2–4 vCPU, 4–8 GB RAM, NVMe), Ubuntu or Debian.

```sh
# 1. docker
curl -fsSL https://get.docker.com | sh
# 2. code and secrets
git clone https://github.com/Bonsaixbt/narra && cd narra
cp .env.example .env            # NARRA_RPC_URL / NARRA_WS_URL: the private node
cd service && cp .env.example .env
# set NARRA_API_ORIGIN, NARRA_RETENTION_H=168, and later NARRA_TOKEN_ADDRESS + NARRA_HOLDER_SECRET
# 3. optional: seed the cache from a machine that already has history
#    scp ~/.narra/narra.db user@vps:~/narra/service/data/narra.db
# 4. run
docker compose up -d --build
curl -s localhost:4663/api/health | jq .ok
# 5. TLS
apt install -y caddy && cp deploy/Caddyfile /etc/caddy/Caddyfile && sed -i 's/api.narra.example/api.yourdomain/' /etc/caddy/Caddyfile && systemctl restart caddy
```

Upgrade: `git pull && docker compose up -d --build`. The cache and backups live in `./data` and `./backups`; the container never needs to be rebuilt to keep them.

Watch `/api/health` from an external uptime monitor every minute; `ok:false` is the alarm.
