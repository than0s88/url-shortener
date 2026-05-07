# Technical Decisions

Three specific choices made for this project. For each: what we considered, what we picked, and why.

---

## 1. Database driver: `better-sqlite3` vs alternatives

**Considered:**
- `better-sqlite3` — synchronous, native binding, mature
- `node:sqlite` — built-in to Node 22+, still experimental
- `sqlite3` (`node-sqlite3`) — async, callback/promise-based, older
- Prisma + SQLite — full ORM with migrations, schema-first

**Picked:** `better-sqlite3`.

**Why:**
- **Synchronous API fits the workload.** Every endpoint here does ≤ 2 trivial queries and returns. There's no benefit from an async callback dance for sub-millisecond local reads, and the synchronous code is easier to reason about and test.
- **Performance.** It's measurably the fastest Node SQLite driver — important because the redirect path (`/[code]`) does a `SELECT` and an `UPDATE` on every hit.
- **Simplicity over Prisma.** We have one table and four queries — bringing in an ORM, a schema language, and a migration runner would add ~40 MB of dependencies and a generation step for nothing. Raw prepared statements are clearer at this scale.
- **Trade-off:** native binding requires a Linux build at deploy time. Mitigated by `prebuild-install` shipping a prebuilt binary for Node 22 + glibc Linux. We also pinned the build via `pnpm.onlyBuiltDependencies` so install reproducibly compiles/links the binding.

**Rejected `node:sqlite`** because it's still flagged experimental in Node 22 and the API surface is smaller — and we didn't want our deployment to ride a moving target during an exam.

---

## 2. Process manager: Docker vs systemd vs PM2

**Considered:**
- **Docker (Compose)** — containerized, image-based deploy, declarative restart policy
- **systemd** — native to every modern Linux, no extra runtime, OS-level supervision
- **PM2** — Node-specific, friendly CLI, ecosystem-familiar

**Picked:** Docker (with Docker Compose).

**Why:**
- **Reproducible artifact.** The image built locally is byte-identical to the one running on the VM. There's no "works on my machine" gap — `docker compose up -d --build` produces the same runtime regardless of the host's Node version, glibc version, or pnpm version.
- **Self-contained runtime.** The host only needs Docker + Nginx. We don't have to install Node 22, configure pnpm, or worry about future Node version drift on the host. The base image (`node:22-bookworm-slim`) pins the runtime explicitly.
- **Easy rollback.** `docker compose down && docker tag url-shortener:previous url-shortener:latest && docker compose up -d` brings back the prior image. With systemd we'd have to `git checkout <sha> && pnpm build && systemctl restart`, which is a multi-step process that can fail mid-way.
- **Reboot resilience is automatic.** `restart: unless-stopped` plus the Docker daemon's own systemd unit (`docker.service`, enabled by default) means the container comes back on boot without any extra config. No need to write a custom unit file.
- **Multi-stage Dockerfile keeps the image small.** Build deps (python, gcc) live only in the deps/builder stages; the final runtime image is `node:22-bookworm-slim` + Next.js standalone bundle (~180 MB). Native `better-sqlite3` is compiled in the deps stage and only its `.node` binding is copied to the final image.
- **Trade-off:** Docker engine is an extra runtime to install (~250 MB) and another moving piece to learn. For a one-app VM, systemd is genuinely simpler — we accepted that cost in exchange for the reproducibility and rollback benefits.

**Rejected systemd** because while it's simpler in raw line count, it couples the deployment to the host's Node/pnpm versions. Any host upgrade risks breaking the build, and rolling back means re-running a full `pnpm install` + `pnpm build`. Docker isolates that.

**Rejected PM2** because it adds a process supervisor *on top of* whatever runtime is on the host, but doesn't solve the host-coupling problem. It's the worst of both worlds for our use case — extra dependency without extra isolation.

---

## 3. Admin auth: HTTP Basic Auth in a Next.js proxy vs session cookies

**Considered:**
- **HTTP Basic Auth** in `proxy.ts`, comparing against env-var credentials
- **Session cookies** with a login form, server-side session store
- **NextAuth.js / Auth.js** with a credentials provider

**Picked:** HTTP Basic Auth in `src/proxy.ts`.

**Why:**
- **Spec exactly matches it.** The exam says "simple password or basic auth pulled from an environment variable" — Basic Auth is the literal name of the option.
- **One admin, no signup, no recovery flow.** A session-based system implies a login UI, CSRF protection on the login POST, a session table or signed cookie, an expiry policy, and a logout button. None of that adds value when there is one credential pair living in a `.env` file.
- **Runs at the edge of the request.** The proxy short-circuits unauthorized requests *before* any DB query or page render. The admin route handler never runs without valid credentials, so there's zero risk of accidentally leaking data via a misrouted response.
- **Constant-time comparison.** `src/lib/auth.ts` uses a hand-rolled timing-safe comparison instead of `===` to defeat trivial timing attacks on the password.
- **Trade-off:** Basic Auth has no logout (browser caches the credentials until the tab closes) and no granular permissions. Both are non-issues here — there is one human admin and no sensitive operations to compartmentalize.

**Rejected NextAuth/Auth.js** because pulling in a 100 KB+ auth framework with an OAuth-shaped abstraction to gate one page would be the textbook example of over-engineering. The exam rule "submitting code or a setup you can't explain" is much easier to satisfy with 25 lines of hand-written Basic Auth than with someone else's auth framework.

---

## Notes

- No starter template was used — the project was scaffolded by hand against the Next.js 16 App Router conventions. (The official `create-next-app` was attempted first but rejected the parent directory name `URLShortener` because of npm's lowercase rule, so I wrote the config files directly.)
