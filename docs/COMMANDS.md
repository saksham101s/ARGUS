# Argus — Commands

Every command runs from the repo root. Scripts read secrets from `.env.local`.
**Live** = talks to your real Supabase / GitHub App / Voyage.

## Everyday development

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (after cloning or pulling new deps) |
| `npm run dev` | Dev server on http://localhost:3000 (sign-in page + dashboard). Also regenerates `AGENTS.md`. |
| `npm run build` | Production build — run before merging; it's what Vercel runs |
| `npm start` | Serve the production build locally (after `build`) |

## Checks (run before every commit / merge)

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript errors across the project |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (`lib/*/*.test.ts`, Node's built-in test runner) — no network |
| `npm run format` | Auto-format everything with Prettier |
| `npm run format:check` | Check formatting without changing files |

All three at once:

```bash
npm run typecheck && npm run lint && npm test
```

Run a single test file:

```bash
npx tsx --test lib/indexing/chunker.test.ts
```

## Live system checks

| Command | What it does |
|---|---|
| `npm run smoke-test` | **Live.** Env vars present, Supabase reachable with the *secret* key, GitHub App authenticates. Expect `3/3 checks passed`. |
| `npm run status` | **Live.** One screen: last 10 webhook deliveries (and their HTTP codes), last 8 reviews (status, files, context), every indexed repo (status, chunk count, errors). Start here when something looks wrong. |

## Code index (Phase 3)

| Command | What it does |
|---|---|
| `npm run index-repo -- owner/name` | **Live, uses Voyage credits.** Index a repo now, no time limit. Incremental: only changed files are re-embedded; an unchanged repo finishes in seconds with no API calls. |
| `npm run index-repo -- owner/name <branch or sha>` | Same, at a specific ref |
| `npm run retrieve -- <review id prefix>` | **Live, read-only.** Show what context retrieval finds for a stored review's changed files, with similarity scores. Get ids from `npm run status`. The best way to judge retrieval quality. |

Example:

```bash
npm run status                       # find a review id, e.g. ff43efdb
npm run retrieve -- ff43efdb         # see what Argus would pull in for it
```

## Webhooks

| Command | What it does |
|---|---|
| `npm run redeliver -- <event>.<action>` | **Live, hits production.** Re-send the latest real GitHub delivery of that event to the App's webhook URL (= "Redeliver" button). Safe: writes are idempotent; a *failed* review is retried, anything else is reported as `duplicate`. |

Examples:

```bash
npm run redeliver -- installation.created       # re-sync the repo list
npm run redeliver -- pull_request.synchronize   # retry the latest PR update
npm run redeliver -- push                        # re-run index update for latest push
```

To exercise the full pipeline from scratch, **open a new PR** (or push a new
commit to one) — a redelivery of an already-processed commit is a no-op.

## Git / deploy flow

```bash
git checkout -b my-change          # work on a branch, never directly on main
npm run typecheck && npm run lint && npm test && npm run build
git push -u origin my-change       # open a PR on GitHub → Argus reviews it
# merge the PR → Vercel deploys main to production
npm run status                     # confirm deliveries are 2xx after deploy
```

## Database migrations

Run by hand, in order, in the **Supabase SQL editor** (no migration runner):
`lib/db/schema.sql` → `lib/db/migrations/002_…` → `003_…` → `004_…`.
All are re-runnable (`if not exists` / `create or replace`).

## Handy one-offs

```bash
npx tsx lib/github/manifest.ts     # print the GitHub App manifest (events/permissions)
npx auth secret                     # generate a new NEXTAUTH_SECRET
```
