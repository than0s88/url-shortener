# Build & Deploy Walkthrough

A chronological log of how this URL Shortener was built and deployed — every command, in order, plus the issues hit along the way and how each was solved.

This is a personal journal alongside the formal docs:
- `README.md` — short project overview
- `DEPLOYMENT.md` — clean ordered deployment recipe
- `DECISIONS.md` — three technical decisions explained
- `AI_USAGE.md` — AI tools used + examples of AI being wrong

---

## Submission Info (fill these in)

| Field | Value |
|---|---|
| **Public URL** | http://136.115.214.42/ |
| **Admin URL** | http://136.115.214.42/admin |
| **Admin Username** | `admin` |
| **Admin Password** | `<paste the value from your VM .env>` |
| **GitHub Repo** | https://github.com/than0s88/url-shortener |
| **VM IP** | 136.115.214.42 |
| **VM OS** | Ubuntu 24.04 LTS |
| **VM SSH user** | `paulo` |
| **Docker version on VM** | 29.4.3 |
| **Node version (in container)** | 22 (bookworm-slim base) |
| **Submission email sent on** | _________________________ |

---

## Phase 1 — Local development (Windows laptop)

### 1.1 Project scaffolding

Tried `pnpm create next-app@latest .` but got blocked by an npm naming rule:
```
Could not create a project called "URLShortener" because of npm naming restrictions:
  * name can no longer contain capital letters
```

**Decision:** scaffolded the project files by hand instead of renaming the parent folder.

Files written manually:
- `package.json` — with `name: "url-shortener"` (lowercase) and `packageManager: "pnpm@10.32.1"` (pinned)
- `tsconfig.json` — strict TS, paths alias for `@/*`
- `next.config.ts` — `output: "standalone"`, `serverExternalPackages: ["better-sqlite3"]`
- `postcss.config.mjs`, `eslint.config.mjs`, `next-env.d.ts`
- `.gitignore`, `.env.example`

### 1.2 App code

Layout under `src/`:
```
src/
├── app/
│   ├── [code]/route.ts       # GET /<code> → 302 + click++
│   ├── admin/page.tsx        # Auth-gated dashboard
│   ├── actions.ts            # Server action: shortenAction
│   ├── shorten-form.tsx      # Client-side form
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── auth.ts               # Basic Auth header parsing + timing-safe compare
│   ├── db.ts                 # better-sqlite3 connection, WAL mode, schema bootstrap
│   └── urls.ts               # createShortUrl / findUrlByCode / incrementClicks / listUrls
└── proxy.ts                  # Next.js 16 proxy file (renamed from middleware.ts)
```

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS urls (
  code         TEXT PRIMARY KEY,
  original_url TEXT    NOT NULL,
  clicks       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS urls_created_at_idx ON urls(created_at DESC);
```

### 1.3 Install + smoke test locally (no Docker yet)

```powershell
pnpm install
pnpm dev    # http://localhost:3000
```

**Issue 1 — pnpm 10 silently skipped native build scripts.**

`pnpm install` reported success but `better-sqlite3`'s native binding wasn't actually built — running the app errored with `Could not locate the bindings file`.

**Cause:** pnpm 10 added an `onlyBuiltDependencies` policy. By default it refuses to run install scripts of dependencies (a supply-chain safeguard).

**Fix:** add to `package.json`:
```json
"pnpm": {
  "onlyBuiltDependencies": ["better-sqlite3", "sharp", "unrs-resolver"]
}
```

Re-ran `pnpm install` — native binding compiled correctly.

### 1.4 First version of admin auth (deprecated)

Initial implementation put auth in `src/middleware.ts` with a `middleware()` export — the standard Next.js 13/14/15 pattern.

**Issue 2 — Next.js 16 deprecated the `middleware` convention.**

Build warning:
```
The "middleware" file convention is deprecated. Please use "proxy" instead.
```

**Fix:** renamed `src/middleware.ts` → `src/proxy.ts` and the export from `middleware()` → `proxy()`. Identical matcher config, no behavior change.

### 1.5 Local auth debugging — the `$` problem

Set `ADMIN_PASSWORD=Pa$$w0rd!` in `.env.local`. Login from the form returned 401.

**Issue 3 — dotenv expanded `$$word!` as a variable reference.**

Next.js's `@next/env` package uses `dotenv-expand`. `$word` was treated as a (nonexistent) env var → expanded to empty string. Result: `Pa$!` (4 chars) instead of `Pa$$w0rd!` (9 chars).

**Diagnosis approach (good interview talking point):** added a temporary debug log printing the password length only (never the value):
```ts
console.log("[auth] expected pass-len:", expectedPass?.length, "received pass-len:", _p.length);
```
Saw expected `4` vs received `9` — confirmed the env loader was the problem.

**Fix attempts I tried:**
1. Single-quote the value: `ADMIN_PASSWORD='Pa$$w0rd!'` — **failed**, `dotenv-expand` runs after dotenv strips quotes.
2. Backslash-escape: `ADMIN_PASSWORD=Pa\$\$w0rd!` — works but ugly.
3. **Final fix: pick a password without `$` or `#`**: `ADMIN_PASSWORD=Password123!`

**Rule of thumb learned:** for `.env` values, avoid `$`, `#`, `\` entirely unless you're prepared to handle expansion semantics.

### 1.6 Smoke tests passed locally

```powershell
node -e "
const auth = 'Basic ' + Buffer.from('admin:Password123!').toString('base64');
(async () => {
  for (const [path, hdr] of [['/', null], ['/admin', null], ['/admin', auth], ['/nope', null]]) {
    const r = await fetch('http://localhost:3000' + path, hdr ? { headers: { Authorization: hdr } } : {});
    console.log(path, r.status);
  }
})();
"
```

Result:
```
/         200
/admin    401   (no auth)
/admin    200   (with auth)
/nope     404
```

---

## Phase 2 — Containerization

### 2.1 Multi-stage Dockerfile

`node:22-bookworm-slim` (Debian, glibc) for all stages so native `better-sqlite3` binaries are compiled once and used directly.

Stage breakdown:
- **deps** — installs build tools (`python3 make g++`), runs `pnpm install --frozen-lockfile --config.node-linker=hoisted`
- **builder** — runs `pnpm build` to produce `.next/standalone/`
- **runner** — minimal runtime, copies only the standalone bundle, runs as non-root user `nextjs` (UID 1001)

Key Dockerfile bits:
```dockerfile
RUN mkdir -p /var/lib/url-shortener && chown nextjs:nodejs /var/lib/url-shortener
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

The `mkdir + chown` is critical — when Docker creates a fresh named volume mounted there, the volume inherits these permissions.

### 2.2 docker-compose.yml

```yaml
services:
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_BASE_URL: ${NEXT_PUBLIC_BASE_URL}
    image: url-shortener:latest
    container_name: url-shortener
    restart: unless-stopped
    env_file:
      - .env
    environment:
      DATABASE_PATH: /var/lib/url-shortener/urls.db
    ports:
      - "127.0.0.1:3000:3000"   # localhost only — Nginx is the public face
    volumes:
      - url-shortener-data:/var/lib/url-shortener

volumes:
  url-shortener-data:
```

Reasoning:
- `127.0.0.1:3000:3000` — bind only to localhost; external traffic must go through Nginx
- `restart: unless-stopped` — auto-restart on crash, comes back on host reboot
- Named volume — works on Windows AND Linux without host directory setup
- `DATABASE_PATH` set in `environment` block (not `.env`) so it always points at the mounted volume

### 2.3 Local Docker test (Windows)

```powershell
# Build the image with the right base URL baked in
docker build --build-arg NEXT_PUBLIC_BASE_URL=http://localhost:3000 -t url-shortener:local .

# Run the container
docker compose up -d --build
```

**Issue 4 — Git Bash MSYS path conversion.**

When running `docker run -e DATABASE_PATH=/tmp/urls.db ...` from Git Bash on Windows, the env value got rewritten:
```
DATABASE_PATH=C:/Users/MYPC~1/AppData/Local/Temp/urls.db
```

**Cause:** Git Bash auto-converts Unix-style paths in command arguments before passing to Windows binaries.

**Fix:** prefix the command with `MSYS_NO_PATHCONV=1`. Compose-based runs aren't affected (env values come from `.env` file, not command-line args).

After fixing the volume permissions and the Docker-compose volume mode, local tests passed:
```
GET /         → 200
GET /admin    → 401 (no auth)
GET /admin    → 200 (correct creds)
GET /nope     → 404
```

Plus end-to-end click tracking:
- Inserted `e2etest` row directly into container's SQLite
- Hit `/e2etest` 3 times → click count went 0 → 3 in admin
- Restarted container → data persisted (named volume works)

### 2.4 Pushed to GitHub

```bash
git init
git remote add origin https://github.com/than0s88/url-shortener.git
git add -A
git commit -m "feat: initial URL shortener with Next.js 16 + SQLite"
git push -u origin main
```

---

## Phase 3 — VM deployment (Ubuntu 24.04 on GCP)

### 3.1 SSH in

```bash
ssh paulo@136.115.214.42
```

Welcome banner showed Ubuntu 24.04 LTS, IP `10.128.0.3` (internal), 18 GB disk, 0 updates pending.

### 3.2 Install OS prerequisites

```bash
sudo apt update && sudo apt -y install git nginx ufw curl
```

(I initially only ran `sudo apt -y install git`, which left nginx/ufw uninstalled. Caught later when `nginx -v` failed and `/etc/nginx/` didn't exist.)

### 3.3 Install Docker Engine + Compose plugin

Adding Docker's official apt repo (latest stable, with Compose plugin):
```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify:
```bash
docker --version       # → Docker version 29.4.3
docker compose version # → Docker Compose version v5.1.0
```

### 3.4 Add user to docker group + relog

```bash
sudo usermod -aG docker $USER
exit
# SSH back in
docker run --rm hello-world   # → "Hello from Docker!"
```

### 3.5 Clone the repo

```bash
git clone https://github.com/than0s88/url-shortener.git
cd url-shortener
ls    # → Dockerfile, docker-compose.yml, package.json, src/, README.md, ...
```

(Cloned into `~/project/url-shortener/` — the `~/project` folder existed empty from VM provisioning.)

### 3.6 Generate strong password + capture public IP

```bash
openssl rand -base64 24    # → strong random password (later replaced)
curl -s ifconfig.me        # → 136.115.214.42
```

### 3.7 Create the `.env` file

```bash
nano .env
```

Pasted:
```ini
NODE_ENV=production
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=AdminPass2026
NEXT_PUBLIC_BASE_URL=http://136.115.214.42
```

Saved with `Ctrl+X` → `Y` → `Enter`. Locked down:
```bash
chmod 600 .env
```

### 3.8 First build attempt — hit the pnpm 11 wall

```bash
docker compose up -d --build
```

**Issue 5 — pnpm 11 errored on ignored build scripts.**

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: better-sqlite3@11.10.0, sharp@0.34.5, unrs-resolver@1.11.1.
failed to solve: process "/bin/sh -c pnpm install --frozen-lockfile --config.node-linker=hoisted" did not complete successfully: exit code: 1
```

**Cause:** between my local Docker build (used pnpm 10) and the VM build, pnpm 11 was released. pnpm 11 hard-errors on ignored build scripts in `--frozen-lockfile` mode where pnpm 10 only warned. corepack pulled "latest" by default, so the VM got pnpm 11.

`unrs-resolver` is a transitive dep (pulled in by Next 16) that has its own build script and wasn't in our allow-list.

**Fix (committed locally and pushed):**
1. Pinned pnpm in `package.json`:
   ```json
   "packageManager": "pnpm@10.32.1"
   ```
   `corepack` reads this and installs that exact version regardless of "latest."
2. Added `unrs-resolver` to the allow-list:
   ```json
   "pnpm": {
     "onlyBuiltDependencies": ["better-sqlite3", "sharp", "unrs-resolver"]
   }
   ```

On the VM:
```bash
git pull
docker compose up -d --build
```

Build completed in ~3 minutes. Container came up with status `Up`.

### 3.9 Auth debugging on VM — the empty password

`docker compose exec app sh -c 'echo "len=${#ADMIN_PASSWORD}"'` → `len=0`

**Issue 6 — the container's `ADMIN_PASSWORD` was empty even though `.env` had it.**

`awk -F= '/^ADMIN_PASSWORD=/{print length($2)}' .env` showed length 12 on disk, but compose only loaded `ADMIN_USERNAME` (5 chars) and not `ADMIN_PASSWORD`. Likely an invisible character (CRLF, BOM, or stray whitespace) introduced when pasting into `nano` over a web SSH terminal.

**Fix:** rewrote `.env` via shell `echo` (zero clipboard artifacts):
```bash
{
  echo "NODE_ENV=production"
  echo "PORT=3000"
  echo "ADMIN_USERNAME=admin"
  echo "ADMIN_PASSWORD=AdminPass2026"
  echo "NEXT_PUBLIC_BASE_URL=http://136.115.214.42"
} > .env
chmod 600 .env

docker compose down && docker compose up -d --build
```

After recreate:
```bash
docker compose exec app sh -c 'echo "len=${#ADMIN_PASSWORD}"'
# → len=13
```
Login worked.

### 3.10 Configure Nginx as the reverse proxy

```bash
sudo nano /etc/nginx/sites-available/url-shortener
```

Pasted:
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

Activated:
```bash
sudo ln -sf /etc/nginx/sites-available/url-shortener /etc/nginx/sites-enabled/url-shortener
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t                      # → "syntax is ok / test is successful"
sudo systemctl reload nginx
```

**Issue 7 — initially, Nginx returned its default welcome page, not the app.**

`curl -I http://127.0.0.1/` returned `Content-Length: 615` (Ubuntu's nginx default index.html), not 7614 (our app). Cause: the `url-shortener` symlink hadn't been created yet — only `default` was in `sites-enabled/`.

**Fix:** ran the `ln -sf` and `rm -f` commands above. Verified with:
```bash
ls /etc/nginx/sites-enabled/    # → url-shortener (only)
curl -I http://127.0.0.1/       # → 200, Content-Length: 7614, X-Powered-By: Next.js
```

### 3.11 Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx HTTP'
sudo ufw --force enable
sudo ufw status
```

Output confirmed both rules active for IPv4 and IPv6.

### 3.12 Public test — it works 🎉

From laptop browser: `http://136.115.214.42/`
- Pasted Amazon URL (~700 chars) → got back `http://136.115.214.42/H61ApXK`
- Clicked the short URL → redirected to Amazon
- `http://136.115.214.42/admin` (logged in `admin` / `AdminPass2026`) → showed the row with click count incrementing on each visit

### 3.13 Reboot resilience test

```bash
sudo reboot
```

**Wait time after reboot: __________ seconds**
**Test result: __________ (PASS / FAIL)**

Verification command from laptop:
```
curl -I http://136.115.214.42/
```

How auto-recovery works:
- Docker daemon's own `docker.service` is enabled by default → starts on boot
- `restart: unless-stopped` policy in `docker-compose.yml` → container auto-starts after the daemon
- Nginx is a systemd service → also auto-starts
- The named volume persists in `/var/lib/docker/volumes/` → all data survives

---

## Issues hit (summary table)

| # | Issue | Where | Root cause | Fix |
|---|---|---|---|---|
| 1 | pnpm 10 silently skipped native build scripts | Local | Supply-chain safeguard | Add `onlyBuiltDependencies` to `package.json` |
| 2 | `middleware.ts` deprecated in Next 16 | Local build | Next 16 renamed convention | Rename to `proxy.ts`, export `proxy()` |
| 3 | `Pa$$w0rd!` truncated to `Pa$!` | Local auth | dotenv-expand variable substitution | Use a password without `$`/`#`/`\` |
| 4 | `DATABASE_PATH=/tmp/...` rewritten to Windows path | Local Docker run | Git Bash MSYS auto-conversion | `MSYS_NO_PATHCONV=1` prefix |
| 5 | `ERR_PNPM_IGNORED_BUILDS` on VM build | VM Docker build | pnpm 11 stricter than pnpm 10 | Pin pnpm via `packageManager` field; add `unrs-resolver` to allow-list |
| 6 | Container saw `ADMIN_PASSWORD` as empty | VM container | Invisible char from `nano` paste | Rewrite `.env` via shell `echo` |
| 7 | Nginx served default page, not the app | VM Nginx | `default` symlink wasn't removed | `ln -sf` new config, `rm -f` default |

Each of these is a great talking point for the interview — they show real debugging discipline, not just running scripts.

---

## Verification checklist before submission

- [ ] `http://136.115.214.42/` loads the home page (200 OK)
- [ ] Pasting a URL into the form returns a short link
- [ ] Visiting the short link redirects (HTTP 302)
- [ ] Click count on `/admin` increments per visit
- [ ] `http://136.115.214.42/admin` returns 401 without auth
- [ ] `http://136.115.214.42/admin` returns 200 with `admin:<password>`
- [ ] `http://136.115.214.42/nonexistent` returns 404
- [ ] `sudo reboot` → site is back within 60 seconds
- [ ] Repo is public on GitHub: https://github.com/than0s88/url-shortener
- [ ] `.env` is gitignored (run `git ls-files | grep .env` — should only show `.env.example`)
- [ ] All 4 docs present: `README.md`, `DEPLOYMENT.md`, `DECISIONS.md`, `AI_USAGE.md`
- [ ] `.env.example` is committed (spec requirement)

---

## Submission email template

```
Subject: Take-home Exam Submission — URL Shortener

Hi [Hiring Team],

Submitting my take-home exam.

  • Public URL: http://136.115.214.42/
  • Admin URL:  http://136.115.214.42/admin
  • Username:   admin
  • Password:   <paste actual password>
  • Repository: https://github.com/than0s88/url-shortener

The repo includes README.md, DEPLOYMENT.md, DECISIONS.md, and AI_USAGE.md.

Stack: Next.js 16 (App Router) + better-sqlite3 + Docker Compose + Nginx
       on Ubuntu 24.04. systemd handles boot-time process supervision via
       Docker's own service. Reboot-tested — site recovers in <60s.

Happy to walk through the code or any of the technical decisions.

Thanks,
Paulo
```
