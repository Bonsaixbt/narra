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

## Cloudflare Tunnel instead of open ports

The compose file carries two optional services. Without a domain: `docker compose --profile quick up -d tunnel-quick`, then `docker compose logs tunnel-quick | grep trycloudflare` prints a temporary public URL (it changes on restart). With the domain on Cloudflare (`narrahood.com`) the named tunnel is locally managed, so nothing is clicked in the dashboard:

```bash
cloudflared tunnel login                       # opens the browser once; pick the narrahood.com zone
cloudflared tunnel create narra                # writes ~/.cloudflared/<id>.json
cloudflared tunnel route dns narra api.narrahood.com
cp ~/.cloudflared/<id>.json service/cloudflared/credentials.json   # gitignored; scp it to the VM
# put the id into service/cloudflared/config.yml (tunnel: <id>) — the ingress there sends api.narrahood.com to http://narra:4663
docker compose --profile tunnel up -d tunnel
cloudflared tunnel info narra                  # shows the VM's connector
```

If another project's `~/.cloudflared/config.yml` exists on the machine that runs these commands, pass `--config /dev/null` and the tunnel id instead of the name, otherwise `route dns` binds the hostname to that other tunnel. The container reads the mounted files as an unprivileged user: keep `service/cloudflared` at 755 and the two files at 644. TLS, DDoS protection and the WAF come from Cloudflare; the VM keeps 80/443 closed. `NARRA_API_ORIGIN` is the site's origin (`https://narrahood.com`).
