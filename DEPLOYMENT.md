# Deployment

How this app is deployed to a Linux VM (Ubuntu 22.04 / 24.04 assumed) using **Docker** for process management and **Nginx** as a reverse proxy. Substitute `<VM_IP>` with your VM's public IP throughout.

## Overview

```
internet  ──►  Nginx :80  ──►  Docker container :3000  ──►  /var/lib/url-shortener/urls.db
              (host)            (url-shortener:latest)        (bind-mounted host volume)
```

- **Process manager:** Docker Compose (`restart: unless-stopped`) — auto-restart on crash, auto-start on boot via the Docker daemon's own systemd unit.
- **Reverse proxy:** Nginx on the host — terminates port 80, forwards to `127.0.0.1:3000`.
- **Persistent storage:** SQLite file at `/var/lib/url-shortener/urls.db` (host volume bind-mounted into the container).
- **Secrets:** all in `/opt/url-shortener/app/.env`, mode `0600`. Compose reads it at `docker compose up`.

---

## One-time VM setup

### 1. SSH in and install prerequisites

```bash
ssh -i <key> <user>@<VM_IP>
sudo apt update && sudo apt -y install git nginx ufw curl
```

### 2. Install Docker Engine + Compose

Official Docker apt repo (avoids the older `docker.io` package):

```bash
# Add Docker's GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Add your user to the `docker` group so you don't need `sudo` for every command:

```bash
sudo usermod -aG docker $USER
# Log out and SSH back in for the group change to take effect.
exit
```

Then SSH back in and verify:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

### 3. Clone the repo

```bash
sudo mkdir -p /opt/url-shortener
sudo chown $USER:$USER /opt/url-shortener
git clone https://github.com/than0s88/url-shortener.git /opt/url-shortener/app
cd /opt/url-shortener/app
```

### 4. Create the persistent SQLite directory

The DB file lives outside `/tmp` and survives container rebuilds + reboots.
UID/GID `1001` matches the `nextjs` user inside the container.

```bash
sudo mkdir -p /var/lib/url-shortener
sudo chown 1001:1001 /var/lib/url-shortener
sudo chmod 0750 /var/lib/url-shortener
```

### 5. Create the `.env` file (secrets)

Generate a strong random admin password:

```bash
openssl rand -base64 24
```

> **Pick one without `$`, `#`, or `\`** — those characters trip dotenv's variable expansion. If yours has them, regenerate.

Get the VM's public IP:

```bash
curl -s ifconfig.me
```

Create the env file (lives in the project dir so `docker compose` picks it up automatically):

```bash
nano /opt/url-shortener/app/.env
```

Paste, then replace the two placeholders:

```ini
NODE_ENV=production
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<paste the strong password>
DATABASE_PATH=/var/lib/url-shortener/urls.db
NEXT_PUBLIC_BASE_URL=http://<paste the VM public IP>
```

Save (`Ctrl+O`, `Enter`, `Ctrl+X`). Lock down the file so only you can read it:

```bash
chmod 600 /opt/url-shortener/app/.env
```

The `.env` file is in `.gitignore` — it will never be committed.

### 6. Build and start the container

```bash
cd /opt/url-shortener/app
docker compose up -d --build
```

First build takes ~2–3 minutes (downloads base image, installs deps, compiles native bindings, builds Next.js standalone bundle). Subsequent runs are instant.

Verify the container is running:

```bash
docker compose ps
docker compose logs -f --tail=50    # Ctrl+C to exit
```

You should see `url-shortener` with status `Up` and a log line like `✓ Ready in NNNms`.

### 7. Configure Nginx as the reverse proxy

```bash
sudo nano /etc/nginx/sites-available/url-shortener
```

Paste:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 16k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
```

Save and enable:

```bash
sudo ln -sf /etc/nginx/sites-available/url-shortener /etc/nginx/sites-enabled/url-shortener
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx HTTP'
sudo ufw --force enable
sudo ufw status
```

---

## Verify

From your laptop:

```bash
curl -I http://<VM_IP>/                            # → 200
curl -I http://<VM_IP>/admin                       # → 401
curl -u admin:<password> -I http://<VM_IP>/admin   # → 200
curl -I http://<VM_IP>/nonexistent                 # → 404
```

Then open `http://<VM_IP>/` in a browser and try the full flow — paste a URL, follow the short link, then check the click count on `/admin`.

## Reboot resilience test (spec hard requirement)

```bash
ssh -i <key> <user>@<VM_IP> sudo reboot
# Wait 30–45 seconds
curl -I http://<VM_IP>/                            # → 200 within 60 seconds
```

How it works:
- The Docker daemon is started on boot by its own systemd unit (`docker.service`).
- The `restart: unless-stopped` policy in `docker-compose.yml` brings the container back up.
- Nginx is also a systemd service that auto-starts.
- The SQLite file in `/var/lib/url-shortener/` is on the persistent root disk — all data survives.

---

## Updating the app

After pushing changes to GitHub:

```bash
cd /opt/url-shortener/app
git pull
docker compose up -d --build
```

A few seconds of downtime while the new image starts.

## Logs

```bash
docker compose logs -f --tail=100        # app logs (Next.js)
sudo journalctl -u nginx -f              # nginx process logs
sudo tail -f /var/log/nginx/access.log   # nginx access log
```

## Inspecting the database

```bash
docker compose exec app node -e \
  "console.log(require('better-sqlite3')('/var/lib/url-shortener/urls.db').prepare('SELECT * FROM urls').all())"
```

## Backup

```bash
sudo apt -y install sqlite3
sudo sqlite3 /var/lib/url-shortener/urls.db ".backup '/tmp/urls-$(date +%F).db'"
```
