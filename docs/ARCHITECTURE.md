# Argus — Architecture

> How the system is built **right now**. Update this file whenever a module,
> table, route, or data flow changes. For status/decisions/next steps see
> [MEMORY.md](./MEMORY.md). For visual rules see [../DESIGN.md](../DESIGN.md).

## 1. What Argus is

A GitHub App that reviews pull requests with **whole-repository context**
(RAG over a pgvector index), not just the diff. Claude produces structured
findings, Semgrep backs security claims, findings are posted as inline PR
comments and stored for a dashboard.

## 2. Runtime pieces

| Piece | What it is | Where |
|---|---|---|
| Web app | Next.js **16.3** App Router (read `node_modules/next/dist/docs/` before using APIs — this version differs from training data) | `app/` |
| Webhook endpoint | Route handler receiving GitHub App events | `app/api/webhooks/github/route.ts` |
| Dashboard auth | Auth.js v5 (`next-auth@5 beta`), GitHub **OAuth App**, JWT sessions, no DB adapter | `lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts` |
| GitHub API | Octokit authenticated as the **GitHub App** (JWT → installation token) | `lib/github/app.ts` |
| Database | Supabase Postgres + pgvector, accessed **only** with the service-role key | `lib/db/*` |
| Background work | Next.js `after()` inside the webhook request (`maxDuration = 300`) | `lib/review/pipeline.ts` |

Two distinct GitHub registrations exist — don't conflate them:
- **GitHub App** (`GITHUB_APP_*`): the bot. Receives webhooks, reads code, posts reviews.
- **GitHub OAuth App** (`GITHUB_OAUTH_*`): "Sign in with GitHub" for the dashboard only.

## 3. Request flow — webhook

```
GitHub ──POST──▶ /api/webhooks/github (route.ts)
  1. read raw bytes → verifyWebhookSignature (HMAC-SHA256, timing-safe)   401 on fail
  2. JSON.parse                                                            400 on fail
  3. dispatch on x-github-event:
       ping                         → 200 pong
       pull_request                 → handlePullRequest
       installation(_repositories)  → handleInstallation
       anything else                → 200 ignored
  4. handler returns { status, body, background? }
  5. if background → after(background)    ← runs AFTER the response is sent
  6. respond (202 for accepted reviews)
```

### handlePullRequest (`lib/github/handlers.ts`)
1. `parsePullRequestEvent` (pure, `lib/github/payloads.ts`):
   - reviewable actions: `opened`, `reopened`, `synchronize`, `ready_for_review`
   - **drafts are ignored** (they get reviewed on `ready_for_review`)
   - returns `ok | ignore (200) | invalid (400)`
2. upsert `installations` row, upsert `repositories` row (active)
3. `createPendingReview` — upsert with `ignoreDuplicates` on
   `(repository_id, pr_number, commit_sha)`. Existing → respond `200 duplicate`
   and do nothing (safe GitHub retries / Redeliver).
4. `supersedeOlderReviews` — older `pending`/`in_progress` reviews of the same
   PR → `superseded` (non-fatal if it fails).
5. background: `runReviewPipeline(reviewId, pr)`.

### handleInstallation
`installation.created/unsuspend` → activate listed repos.
`installation.deleted/suspend` → deactivate **all** repos of that installation
(rows are kept so review history survives).
`installation_repositories.added/removed` → activate/deactivate those repos.

### runReviewPipeline (`lib/review/pipeline.ts`)
Current (Phase 2): fetch changed files (paginated, ≤3000 by GitHub's cap) →
store as `reviews.changed_files` JSONB. On any error → `status=failed`,
`error=<message>`. Status is otherwise left `pending` — Phase 4 will move it
through `in_progress → completed`.

Planned extension point — the pipeline is where Phases 3–5 plug in:
`fetch files → retrieve context (P3) → Claude review (P4) → Semgrep (P5) →
store findings → post PR review (P5)`.

## 4. Database (`lib/db/schema.sql` + `lib/db/migrations/*.sql`)

Migrations are **run by hand in the Supabase SQL editor**, in order:
`schema.sql` → `002_add_changed_files.sql` → `003_webhook_hardening.sql`.
There is no migration runner/tracking table.

| Table | Key columns | Notes |
|---|---|---|
| `installations` | `id` (GitHub installation id), `account_login`, `account_type` | |
| `repositories` | `id` (GitHub repo id), `installation_id`, `full_name`, `default_branch`, `is_active` | cascade-deletes from installations |
| `reviews` | `id uuid`, `repository_id`, `pr_number`, `commit_sha`, `status`, `changed_files jsonb`, `pr_title`, `pr_author`, `head_ref`, `base_sha`, `error`, `started_at`, `completed_at` | unique `(repository_id, pr_number, commit_sha)` |
| `findings` | `review_id`, `category`, `severity` (info/warning/critical), `file`, `line_start/end`, `message`, `suggestion` | unused until Phase 4 |
| `code_chunks` | `repository_id`, `file_path`, `line_start/end`, `content`, `embedding vector(1024)` | HNSW cosine index; unused until Phase 3 |

Review status: `pending → in_progress → completed | failed`, plus `superseded`.

**RLS is enabled on every table with no policies** (migration 003) — the
anon key can't touch anything; the server uses the service-role key, which
bypasses RLS. Never create a browser Supabase client with these tables.

## 5. Module map

```
app/
  layout.tsx                  fonts (Space Grotesk / IBM Plex Mono), globals
  globals.css                 design tokens → Tailwind v4 @theme
  sign-in/page.tsx            sign-in (server action → signIn('github'))
  (dashboard)/layout.tsx      auth guard (redirect /sign-in), header, sign-out
  (dashboard)/page.tsx        "/" — repo list (empty-state stub)
  api/auth/[...nextauth]/     Auth.js handlers
  api/webhooks/github/        webhook endpoint (thin: verify, parse, dispatch)
lib/
  auth.ts                     Auth.js config
  db/client.ts                memoized service-role Supabase client (+ ws transport)
  db/installations.ts         upsertInstallation, activate/deactivateRepositories
  db/reviews.ts               ReviewStatus, ChangedFile, create/supersede/updateReview
  github/app.ts               getInstallationClient, getAppClient (normalizes \n in PEM)
  github/verify.ts            webhook HMAC verification
  github/payloads.ts          PURE payload types + parsers (unit-tested)
  github/handlers.ts          event handlers (DB side effects, returns HandlerResult)
  github/manifest.ts          reference GitHub App manifest (events/permissions)
  review/pipeline.ts          background review pipeline
scripts/smoke-test.ts         env + Supabase + GitHub App checks (uses lib clients)
```

## 6. Conventions

- **Layering:** route = HTTP only; `lib/github/payloads.ts` = pure parsing;
  `lib/github/handlers.ts` = orchestration; `lib/db/*` = one function per query;
  `lib/review/*` = long-running work. Keep new code in this shape.
- Handlers never call `after()` themselves — they return `background`.
- Every webhook write must be idempotent (upserts / unique keys).
- Log prefix `[webhook]` / `[review <id8>]`.
- Tests: Node's built-in `node:test` run via `tsx` — `npm test` runs
  `lib/*/*.test.ts` (one directory deep). No test framework dependency.
- Formatting: Prettier (`.prettierrc`, printWidth 100, single quotes).
- Node 20 locally. supabase-js needs the `ws` transport on Node < 22 (done in
  `lib/db/client.ts`). Upgrading to Node 22 is recommended.

## 7. Environment variables

See `.env.example`. Required now: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_OAUTH_CLIENT_ID`,
`GITHUB_OAUTH_CLIENT_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXTAUTH_SECRET`/`AUTH_SECRET`.
Later: `ANTHROPIC_API_KEY` (P4), `VOYAGE_API_KEY` (P3).

## 8. Commands

| Command | Does |
|---|---|
| `npm run dev` | dev server (regenerates `AGENTS.md`) |
| `npm run build` | production build |
| `npm test` | unit tests |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | static checks |
| `npm run smoke-test` | live check of env + Supabase + GitHub App |
