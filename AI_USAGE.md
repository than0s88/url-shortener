# AI Usage

## Tools used

- **Claude Code (Anthropic)** — primary pair-programmer for scaffolding the Next.js app, building the SQLite layer and proxy/auth code, writing the Dockerfile and compose, debugging deployment issues, and writing this set of docs. Used for both implementation and as a sounding board for design decisions.

No other AI assistants (Copilot, Cursor, ChatGPT) were used on this project.

## How I used it

- Scaffolded the Next.js 16 file layout, `package.json` (with pinned `packageManager`), `tsconfig.json`, `next.config.ts`, Tailwind v4 config, and ESLint flat config.
- Wrote `src/lib/db.ts`, `src/lib/urls.ts`, `src/lib/auth.ts`, the home/admin pages, the `[code]` route handler, and the proxy.
- Wrote the multi-stage `Dockerfile`, `docker-compose.yml`, and `.dockerignore`.
- Drafted the Nginx server block in `DEPLOYMENT.md`.
- Drafted this `AI_USAGE.md`, `DECISIONS.md`, `WALKTHROUGH.md`, and `README.md`.

I read every file the AI produced, ran `tsc --noEmit`, ran `next build`, smoke-tested the dev server with `curl`, smoke-tested the Docker container locally, and finally smoke-tested the live VM deployment before considering the work done. I can explain every line of every file in the repo — that was the bar.

## Where the AI was wrong or unhelpful

Five real examples, in order of when they hit, ranging from a deprecation oversight to misjudgments about how external tools would behave.

### 1. Used the deprecated `middleware` convention (Next 16)

The AI's first cut at gating `/admin` put the auth check in `src/middleware.ts` with a `middleware()` export — the standard Next.js 13/14/15 pattern.

`next build` warned:
> `The "middleware" file convention is deprecated. Please use "proxy" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy`

Next.js 16 renamed the convention from `middleware` → `proxy`. The AI's training pre-dated the rename. I caught it on a build, renamed the file to `src/proxy.ts` and the export to `proxy()`. Matcher config and internals stayed identical.

**Lesson:** AI-generated framework code can lag the framework's own conventions by months. Always run a real build and read the warnings.

### 2. pnpm 10 silently skipped the native build

After `pnpm install` finished cleanly, the AI told me the install was complete. It wasn't — `better-sqlite3` is a native module, and pnpm 10 by default refuses to run install scripts of dependencies for supply-chain safety. The output had a small warning at the bottom:

> `Ignored build scripts: better-sqlite3@11.10.0, sharp@0.34.5, unrs-resolver@1.11.1.`
> `Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.`

I tried `pnpm rebuild better-sqlite3` first — silent no-op. The actual fix was adding `pnpm.onlyBuiltDependencies` to `package.json` and re-running `pnpm install`. After that, the prebuilt binary downloaded correctly and a `node -e "new Database(':memory:')"` test confirmed the binding loaded.

**Lesson:** "install completed without errors" ≠ "install actually works." A real smoke test (load the binding in Node) was what caught this.

### 3. Dotenv expansion truncated the `$$` password

I set `ADMIN_PASSWORD=Pa$$w0rd!` in `.env`. Login returned 401. The AI initially blamed the wrong password format and suggested several quoting fixes that didn't work.

Adding a debug log that printed the password length (only) revealed the AI's diagnosis was wrong: my password was 9 chars on disk but Next.js was loading only 4 chars (`Pa$!`). The cause was `dotenv-expand` substituting `$$word` as a (nonexistent) shell variable.

**What worked:**
- Single-quoting (`'Pa$$w0rd!'`) — failed in `@next/env`, which runs expansion after dotenv strips quotes
- Backslash-escaping (`Pa\$\$w0rd!`) — worked but ugly
- Picking a password without `$` or `#` — final fix

**Lesson:** the AI's first guesses were plausible but wrong. The fix only became clear after I added instrumentation (a length-only debug log) that gave evidence about what the runtime was actually seeing. Trusting the AI's confident debug suggestions over actual measurement would have wasted hours.

### 4. Git Bash silently rewrote `/tmp/urls.db` to a Windows path

When testing the Docker container locally (Windows + Git Bash), the AI suggested:
```bash
docker run -e DATABASE_PATH=/tmp/urls.db ...
```

The container started, but every DB operation 500'd. Logs showed the container was trying to open `/app/C:/Users/MYPC~1/AppData/Local/Temp/urls.db` — a mangled path.

**Cause:** Git Bash's MSYS layer auto-converts Unix-style path arguments to Windows paths before passing them to Windows binaries. `docker run -e DATABASE_PATH=/tmp/urls.db` was secretly becoming `-e DATABASE_PATH=C:/Users/.../Temp/urls.db`.

**Fix:** prefix with `MSYS_NO_PATHCONV=1`, OR use docker-compose with values from a `.env` file (compose reads files literally — no shell rewriting).

**Lesson:** the AI didn't know about Git Bash's path conversion behavior, and the symptom (a runtime path that didn't exist anywhere I'd typed it) was confusing until we read the container's actual env. `docker exec <container> env` is now my first move when env-related bugs appear.

### 5. pnpm 11 broke the build between local test and VM deploy

Local Docker build worked fine. A few hours later, the same Dockerfile failed on the VM with:
```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: ..., unrs-resolver@1.11.1.
```

**Cause:** pnpm 11 was published in those few hours. `corepack enable` (no version pin) installs whatever is "latest." pnpm 11 hard-errors on ignored build scripts in `--frozen-lockfile` mode where pnpm 10 only warned. `unrs-resolver` is a transitive dep we hadn't added to the allow-list.

**Fix:** pin the toolchain in `package.json`:
```json
"packageManager": "pnpm@10.32.1"
```
And add `unrs-resolver` to `onlyBuiltDependencies` for safety.

**Lesson — the most important one:** the AI's Dockerfile didn't pin the package manager version. "Always use latest" looks convenient until "latest" silently changes between two builds and breaks production. Always pin the toolchain (Node, pnpm, base image) — not just dependencies. This is the difference between "works on my machine" and "reproducible deploy."

### 6. Pasting `.env` into nano introduced an invisible character

After `docker compose up -d --build`, login returned 401 from the VM. `awk` on the `.env` file showed `ADMIN_PASSWORD` had 12 characters, but inside the container `${#ADMIN_PASSWORD}` reported `0`. `ADMIN_USERNAME` loaded fine — only `ADMIN_PASSWORD` was empty.

**Cause:** likely an invisible character (CRLF, BOM, or stray whitespace) introduced when pasting into `nano` over a web SSH terminal. Docker-compose's env-file parser was stricter than `awk` and silently dropped the malformed line.

**Fix:** rewrote `.env` via shell `echo` (zero clipboard artifacts):
```bash
{
  echo "NODE_ENV=production"
  echo "ADMIN_USERNAME=admin"
  echo "ADMIN_PASSWORD=AdminPass2026"
  ...
} > .env
```
Then `docker compose down && docker compose up -d --build`. After that, `${#ADMIN_PASSWORD}` reported 13 and login worked.

**Lesson:** when copy-pasting into a web SSH terminal, prefer `cat <<'EOF'` heredoc or `echo` blocks over interactive editors — they don't pick up clipboard formatting artifacts. The AI suggested `nano` first because it's beginner-friendly, but `nano` over a web SSH terminal is where I burned the most time on the entire deployment.

### 7. Forgot to remove Nginx's default site

After configuring `/etc/nginx/sites-available/url-shortener` and reloading, `curl` from inside the VM returned 200 — but the response was Ubuntu's default `nginx` welcome page (Content-Length 615), not our app (Content-Length 7614).

**Cause:** Nginx loads everything in `/etc/nginx/sites-enabled/`. The new config wasn't symlinked yet, AND the old `default` symlink was still active and matched the request first.

**Fix:**
```bash
sudo ln -sf /etc/nginx/sites-available/url-shortener /etc/nginx/sites-enabled/url-shortener
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl reload nginx
```

**Lesson:** Nginx's `sites-available` / `sites-enabled` model is a Debian/Ubuntu convention, not core Nginx behavior. The AI's deployment guide assumed I'd intuit "of course you remove default and symlink the new one" but didn't make those two steps explicit enough to be unmissable. The fix was trivial, but the diagnosis took five minutes of staring at Content-Length numbers.

---

## Overall reflection

The AI was useful as a fast typist for boilerplate (config files, Dockerfile structure, server actions) and for explaining unfamiliar tooling (pnpm internals, dotenv-expand semantics, systemd vs Docker boot supervision). It was unhelpful when the failure mode was outside its training (pnpm 11's behavior change, Git Bash MSYS conversion, web-SSH paste artifacts) — and in those cases, **debugging via real measurement** (length logs, `docker exec env`, `awk` on the file) beat the AI's confident-sounding wrong guesses every time.
