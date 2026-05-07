# URL Shortener

A small URL shortener built for a take-home deployment exam. Built with **Next.js 16 (App Router)** and **SQLite** (`better-sqlite3`), deployed to a Linux VM behind **Nginx** with **systemd** keeping the Node process alive.

## Features

- **Home page** (`/`) — paste a long URL, get a short one back
- **Redirect** (`/<code>`) — HTTP 302 to the original URL, increments a click counter
- **Admin** (`/admin`) — HTTP Basic Auth-gated table of all short URLs, original URLs, click counts, and creation timestamps
- **Click tracking** — every successful redirect bumps `clicks` for that code

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Required by spec |
| Language | TypeScript (strict) | Type safety |
| Database | SQLite via `better-sqlite3` | Single-file, synchronous, fast |
| Styling | Tailwind CSS v4 | Minimal config, modern |
| Auth (admin) | HTTP Basic Auth via Next.js Proxy | One admin user — simplest correct option |
| Process manager (prod) | Docker Compose | Reproducible image, declarative restart policy |
| Reverse proxy (prod) | Nginx (host) | Stable, universal, well-documented |

See [DECISIONS.md](./DECISIONS.md) for the rationale on the major choices.

## Local development

Requirements: Node 20+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env.local      # then edit ADMIN_PASSWORD
pnpm dev                        # http://localhost:3000
```

The first run creates `./data/urls.db` automatically.

### Environment variables

See [`.env.example`](./.env.example). All secrets must live in env vars — never commit `.env`.

| Variable | Purpose | Example |
|---|---|---|
| `ADMIN_USERNAME` | Username for `/admin` Basic Auth | `admin` |
| `ADMIN_PASSWORD` | Password for `/admin` Basic Auth | _(strong random)_ |
| `DATABASE_PATH` | SQLite file location | `./data/urls.db` (dev) · `/var/lib/url-shortener/urls.db` (prod) |
| `NEXT_PUBLIC_BASE_URL` | Origin used to build short URLs | `http://<vm-ip>` |

## Project layout

```
src/
├── app/
│   ├── [code]/route.ts     # GET /<code> → 302 redirect + click++
│   ├── admin/page.tsx      # Admin dashboard (gated by proxy.ts)
│   ├── actions.ts          # Server action: shortenAction
│   ├── shorten-form.tsx    # Client component: the shorten form + result
│   ├── globals.css         # Tailwind import + theme tokens
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Home page
├── lib/
│   ├── auth.ts             # Basic Auth header parsing + timing-safe compare
│   ├── db.ts               # better-sqlite3 connection + schema bootstrap
│   └── urls.ts             # createShortUrl / findUrlByCode / incrementClicks / listUrls
└── proxy.ts                # Next.js 16 proxy (renamed from middleware) — protects /admin
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full Linux VM deploy procedure (Nginx + systemd + persistent SQLite + reboot resilience).

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) — step-by-step VM setup
- [DECISIONS.md](./DECISIONS.md) — three technical decisions, alternatives considered
- [AI_USAGE.md](./AI_USAGE.md) — AI tools used + an example of AI being wrong
