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

## Google Cloud (what we run)

```sh
gcloud compute instances create narra-1 --zone europe-west3-a --machine-type e2-standard-2 \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud --boot-disk-size 60GB --boot-disk-type pd-ssd \
  --tags http-server,https-server
gcloud compute firewall-rules create narra-allow-web --network default --allow tcp:80,tcp:443 --target-tags http-server,https-server
gcloud compute ssh narra-1 --zone europe-west3-a      # then the steps above; docker via get.docker.com
```

`service/.env` on the box must not carry inline `# comments` — docker compose interpolates `$` inside them. Seed the cache by uploading a `sqlite3 .backup` of a machine that already has history (`gzip -1`, `gcloud compute scp`, stop the container, replace `data/narra.db`, start).

Update: `gcloud compute ssh narra-1 --zone europe-west3-a --command "cd ~/narra && git pull && cd service && sudo docker compose up -d --build"`.
