# AI Usage

## Tools used

- **Claude Code (Anthropic)** — primary pair-programmer for scaffolding, the SQLite layer, the proxy/auth code, and writing this set of docs. Used for both code and reviewing my own design decisions.

No other AI assistants (Copilot, Cursor, ChatGPT) were used on this project.

## How I used it

- Scaffolded the Next.js 16 file layout, `package.json`, `tsconfig.json`, `next.config.ts`, and Tailwind v4 config.
- Wrote `src/lib/db.ts`, `src/lib/urls.ts`, `src/lib/auth.ts`, the home/admin pages, the `[code]` route handler, and the proxy.
- Drafted the systemd unit file and the Nginx server block in `DEPLOYMENT.md`.
- Drafted this `AI_USAGE.md`, `DECISIONS.md`, and the `README.md`.

I read every file the AI produced, ran `tsc --noEmit`, ran `next build`, and smoke-tested the dev server with `curl` before considering the code "done." I can explain every line of every file in the repo — that was the bar.

## Where the AI was wrong or unhelpful

### Example 1 — used the deprecated `middleware` convention

I asked for an HTTP Basic Auth gate on `/admin`. The AI's first version put it in `src/middleware.ts` with a `middleware()` export, which is the standard Next.js 13/14/15 pattern.

This compiled and ran, but `next build` warned:

> `The "middleware" file convention is deprecated. Please use "proxy" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy`

Next.js 16 renamed the convention from `middleware` → `proxy`. The AI's training pre-dated the rename, so it produced perfectly valid Next 15 code in a Next 16 project. I caught the warning during the build verification step and renamed the file to `src/proxy.ts` and the export to `proxy()`. The matcher config and all other internals stayed identical.

**Lesson:** AI-generated framework code can lag the framework's own conventions by several months. Always run a real build, read the warnings — don't just trust the type-check.

### Example 2 — pnpm 10 silently skipped the native build

When `pnpm install` finished successfully, the AI said the install was complete. It wasn't — `better-sqlite3` is a native module, and pnpm 10 now refuses to run install scripts of dependencies by default for supply-chain safety. The output had a small warning at the bottom:

> `Ignored build scripts: better-sqlite3@11.10.0, sharp@0.34.5, unrs-resolver@1.11.1.`
> `Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.`

I tried `pnpm rebuild better-sqlite3` first — it returned with no output and the binding still wasn't there. The actual fix was to add an `onlyBuiltDependencies` allow-list to `package.json`:

```json
"pnpm": {
  "onlyBuiltDependencies": ["better-sqlite3", "sharp"]
}
```

…and re-run `pnpm install`. After that the prebuilt binary downloaded correctly and a `node -e` smoke test confirmed the binding loaded.

**Lesson:** the AI didn't know about pnpm 10's stricter default and told me the install had succeeded when functionally it hadn't. Reading the install warnings ourselves and running an end-to-end smoke test (`node -e "new Database(':memory:')"`) caught the gap. "Install completed without errors" is not the same as "install actually works."
