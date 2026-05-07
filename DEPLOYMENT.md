# Deployment

How this app is deployed to a Linux VM (Ubuntu 22.04/24.04 assumed) and what to run on a fresh server. Substitute `<VM_IP>` with the public IP throughout.

## Overview

```
internet  ──►  Nginx :80  ──►  Next.js :3000  ──►  SQLite file at /var/lib/url-shortener/urls.db
              (reverse proxy)   (managed by systemd)
```

- **Process manager:** `systemd` — auto-restart on crash, auto-start on boot.
- **Reverse proxy:** `nginx` — terminates port 80, forwards to `127.0.0.1:3000` with `X-Forwarded-*` headers.
- **Persistent storage:** SQLite file in `/var/lib/url-shortener/` (survives reboots, owned by app user, `0640` permissions).
- **Secrets:** all in `/etc/url-shortener.env`, owned by `root:url-shortener`, mode `0640`. The systemd unit loads it via `EnvironmentFile=`.

## One-time VM setup

### 1. SSH in and install prerequisites

```bash
ssh -i <key> <user>@<VM_IP>
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git build-essential nginx ufw
```

### 2. Install Node.js 22 (via NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
sudo corepack enable
node -v && pnpm -v
```

### 3. Create a system user for the app

```bash
sudo useradd --system --create-home --home /opt/url-shortener --shell /usr/sbin/nologin url-shortener
```

### 4. Clone the repo and install deps

```bash
sudo -u url-shortener git clone <YOUR_REPO_URL> /opt/url-shortener/app
cd /opt/url-shortener/app
sudo -u url-shortener pnpm install --frozen-lockfile
sudo -u url-shortener pnpm build
```

### 5. Create the persistent data directory

```bash
sudo mkdir -p /var/lib/url-shortener
sudo chown url-shortener:url-shortener /var/lib/url-shortener
sudo chmod 0750 /var/lib/url-shortener
```

### 6. Create the env file (secrets, not in the repo)

```bash
sudo install -m 0640 -o root -g url-shortener /dev/null /etc/url-shortener.env
sudo nano /etc/url-shortener.env
```

Paste:

```ini
NODE_ENV=production
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<paste a strong random password here>
DATABASE_PATH=/var/lib/url-shortener/urls.db
NEXT_PUBLIC_BASE_URL=http://<VM_IP>
```

> **Note:** `NEXT_PUBLIC_BASE_URL` is read at **build time** for client-side bundles. After changing it, re-run `pnpm build` and restart the service.

### 7. Install the systemd unit

```bash
sudo nano /etc/systemd/system/url-shortener.service
```

Paste:

```ini
[Unit]
Description=URL Shortener (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=url-shortener
Group=url-shortener
WorkingDirectory=/opt/url-shortener/app
EnvironmentFile=/etc/url-shortener.env
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=5
# Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/url-shortener

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now url-shortener
sudo systemctl status url-shortener
```

### 8. Configure Nginx as a reverse proxy

```bash
sudo nano /etc/nginx/sites-available/url-shortener
```

Paste:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Body size limit — URL shortener bodies are tiny
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

Enable + reload:

```bash
sudo ln -s /etc/nginx/sites-available/url-shortener /etc/nginx/sites-enabled/url-shortener
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 9. Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx HTTP'
sudo ufw --force enable
sudo ufw status
```

## Verify

From your laptop:

```bash
curl -I http://<VM_IP>/                     # → 200
curl -u admin:<password> -I http://<VM_IP>/admin   # → 200
curl -I http://<VM_IP>/admin                # → 401 (no creds)
curl -I http://<VM_IP>/nonexistent          # → 404
```

Then create a short URL via the home page and confirm `/<code>` returns `302` to the original URL and the click count increments on the admin page.

## Reboot resilience test

```bash
ssh -i <key> <user>@<VM_IP> sudo reboot
# Wait ~30–45 seconds
curl -I http://<VM_IP>/                     # should be 200 well within 60 seconds
```

`systemd` brings up `nginx` and `url-shortener` automatically on boot. The SQLite file in `/var/lib/url-shortener/` is on the persistent root disk, so all data survives.

## Updating the app

```bash
cd /opt/url-shortener/app
sudo -u url-shortener git pull
sudo -u url-shortener pnpm install --frozen-lockfile
sudo -u url-shortener pnpm build
sudo systemctl restart url-shortener
```

## Logs

```bash
sudo journalctl -u url-shortener -f          # app logs
sudo journalctl -u nginx -f                  # nginx logs
sudo tail -f /var/log/nginx/access.log
```

## Backup (optional)

The whole app state is one file. To back it up:

```bash
sudo sqlite3 /var/lib/url-shortener/urls.db ".backup '/tmp/urls-$(date +%F).db'"
```
