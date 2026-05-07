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

## 2. Process manager: systemd vs PM2 vs Docker

**Considered:**
- **systemd** — native to every modern Linux, no extra deps, OS-level supervision
- **PM2** — Node-specific, friendly CLI, ecosystem-familiar, can save process list
- **Docker** — full container, isolated runtime, also handles restart policy

**Picked:** systemd.

**Why:**
- **Reboot resilience is the spec's hard requirement.** systemd is what brings the box back on boot anyway — using it directly removes a layer (PM2's `pm2 startup` registers a systemd unit under the hood). Fewer moving parts = fewer failure modes.
- **No extra runtime to install or keep updated.** The app's only external dependencies are nginx and Node. PM2 would mean another global package to keep current and patch.
- **Native log integration.** `journalctl -u url-shortener` gives us structured logs with timestamps and persistence across reboots without setting anything up. PM2 logs to its own files in `~/.pm2/logs/` — fine, but extra to learn.
- **Hardening hooks built in.** Setting `NoNewPrivileges`, `ProtectSystem`, `ProtectHome`, and `ReadWritePaths` in the unit file gives us defense-in-depth that PM2 can't add.
- **Trade-off:** I have to write an `EnvironmentFile` and a unit file by hand instead of `pm2 start npm --name x`. That's ~20 lines of config for the lifetime gain — a fair trade.

**Rejected Docker** because the spec explicitly considers PM2/systemd/Docker equivalent options, and Docker would add image-build complexity, a container runtime, and a separate networking story for a single Node process talking to one SQLite file on a host volume. Overkill at this scale.

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
