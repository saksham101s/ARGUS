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
| Code index (RAG) | Git Trees/Blobs API → heuristic chunker → Voyage `voyage-code-3` (1024-d) → pgvector | `lib/indexing/*`, `lib/review/context.ts` |

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
       push                         → handlePush
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
   `(repository_id, pr_number, commit_sha)`. If it already exists:
   `retryFailedReview` resets it to `pending` **only if it is `failed`**
   (conditional update, race-safe) and the pipeline reruns; otherwise respond
   `200 duplicate` and do nothing. So Redeliver = retry for failed reviews.
4. `supersedeOlderReviews` — older `pending`/`in_progress` reviews of the same
   PR → `superseded` (non-fatal if it fails).
5. background: `runReviewPipeline(reviewId, pr)`.

### handleInstallation
`installation.created/unsuspend` → activate listed repos.
`installation.deleted/suspend` → deactivate **all** repos of that installation
(rows are kept so review history survives).
`installation_repositories.added/removed` → activate/deactivate those repos.

### handlePush
Only pushes to the repo's **default branch** (not deletions) and only for
repos already indexed (`index_status != none`) → background
`indexRepository(ref = pushed sha, budget 250s)`. Unindexed repos are left
alone: indexing is lazy (first PR).

### runReviewPipeline (`lib/review/pipeline.ts`)
1. fetch changed files (paginated, ≤3000 by GitHub's cap) → `reviews.changed_files`.
   Error here → `status=failed`, `error=<message>`.
2. `gatherContext` (**non-fatal** — failure logs and the review continues diff-only):
   - if repo `index_status != ready` → `indexRepository` on the default branch,
     deadline = pipeline start + 180s
   - `retrieveContext` → `reviews.context`
Status is otherwise left `pending` — Phase 4 moves it `in_progress → completed`.

Remaining extension point: `→ Claude review (P4) → Semgrep (P5) → store
findings → post PR review (P5)`.

## 3b. Code index (Phase 3)

**Indexing** — `indexRepository(repo, {ref, deadline})` in `lib/indexing/indexer.ts`:
1. `claimIndexing` — atomic `index_status → indexing` (a claim older than 15 min
   is considered dead and can be taken over). Lost race → `skipped`.
2. `repos.getCommit(ref)` → `git.getTree(recursive)`; keep blobs passing
   `shouldIndexFile` (path/extension/size rules in `filter.ts`), max 3000 files.
3. Diff against `getIndexedFiles` (path → stored key, from `chunk_index = 0` rows):
   changed/new → re-index, gone → delete. **Incremental by blob sha**; the
   same code path does the first full index and every update. The stored
   key (`code_chunks.blob_sha`) is `v<CHUNKER_VERSION>:<git blob sha>`, so
   bumping `CHUNKER_VERSION` re-chunks every file once.
4. Batches of 20 files: `git.getBlob` (8 concurrent) → `isIndexableContent`
   (no NUL bytes, avg line ≤ 300 chars) → `chunkFile` → `embed(..., 'document')`
   → `replaceFileChunks` (delete + insert per file).
5. Past `deadline` → stop, `index_status = partial` (next run resumes).
   Done → `ready` + `indexed_commit_sha`. Error → `failed` + `index_error`.

**Chunking** — `chunkFile` (`chunker.ts`, pure): boundaries at column-0
declarations (regex over common keywords across languages) or markdown
`#`–`###` headings; leading comments/JSDoc/decorators attach to the
declaration below. Units are packed to ~60 lines; a pack under 15 lines
(e.g. just imports) merges into the next unit if the result fits 120 lines;
units > 120 lines become
overlapping 120-line windows (10 overlap); chunks capped at 8000 chars.
Embedded text = `File: <path> (lines a-b)\n\n<content>`.

**Embeddings** — `embed(texts, 'document' | 'query')` (`embeddings.ts`): plain
`fetch` to Voyage, batches ≤128 inputs / ~100K est. tokens (est = chars/3).
On 429: wait `retry-after` or 65s (limits are per minute), then — if the
batch is > 8K est. tokens — split it in half and lower a module-level
`tokenCap` so later batches are pre-sized; ≤ 8K batches are resent whole
(splitting further only adds requests against the 3 RPM free-tier limit).
5xx: exponential backoff. 6 attempts per batch.

**Retrieval** — `retrieveContext(repoId, changedFiles)` (`lib/review/context.ts`):
`pickQueryFiles`: code files only, unless the PR is docs-only (doc diffs
crowded code out of the budget on PR #1); largest `changes` first, max 20.
One query per file = path + added/context lines of its patch (`queryForChange`). `match_code_chunks` RPC, 8 matches each,
**excluding the changed files themselves** (their new content is in the
diff; the index holds the old version). `selectContext` dedupes, drops
similarity < 0.35, keeps the best 15 chunks / 30K chars.

## 4. Database (`lib/db/schema.sql` + `lib/db/migrations/*.sql`)

Migrations are **run by hand in the Supabase SQL editor**, in order:
`schema.sql` → `002_add_changed_files.sql` → `003_webhook_hardening.sql` →
`004_code_index.sql`.
There is no migration runner/tracking table.

| Table | Key columns | Notes |
|---|---|---|
| `installations` | `id` (GitHub installation id), `account_login`, `account_type` | |
| `repositories` | `id` (GitHub repo id), `installation_id`, `full_name`, `default_branch`, `is_active`, `index_status` (none/indexing/ready/partial/failed), `index_started_at`, `indexed_at`, `indexed_commit_sha`, `index_error` | cascade-deletes from installations |
| `reviews` | `id uuid`, `repository_id`, `pr_number`, `commit_sha`, `status`, `changed_files jsonb`, `context jsonb` (retrieved chunks), `pr_title`, `pr_author`, `head_ref`, `base_sha`, `error`, `started_at`, `completed_at` | unique `(repository_id, pr_number, commit_sha)` |
| `findings` | `review_id`, `category`, `severity` (info/warning/critical), `file`, `line_start/end`, `message`, `suggestion` | unused until Phase 4 |
| `code_chunks` | `repository_id`, `file_path`, `chunk_index`, `line_start/end`, `content`, `language`, `blob_sha`, `embedding vector(1024)` | unique `(repository_id, file_path, chunk_index)`; HNSW cosine index |

RPC `match_code_chunks(p_repository_id, p_embedding, p_match_count, p_exclude_paths)`
→ nearest chunks with `similarity = 1 - cosine distance`. plpgsql; raises
`hnsw.ef_search` to 200 via a best-effort transaction-local `set_config` at
call time (repo filter is applied after the HNSW scan). Supabase refuses
`SET hnsw.ef_search` as a function attribute (42501), hence the runtime call.
Execute is revoked from anon/authenticated — service role only.

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
  github/app.ts               getInstallationClient, getAppClient
  github/private-key.ts       normalizePrivateKey: quotes / \n / spaces / base64 → canonical PEM
  github/verify.ts            webhook HMAC verification
  github/payloads.ts          PURE payload types + parsers (unit-tested)
  github/handlers.ts          event handlers (DB side effects, returns HandlerResult)
  github/manifest.ts          reference GitHub App manifest (events/permissions)
  db/code-index.ts            index state (claim/finish), chunk CRUD, matchChunks RPC
  indexing/filter.ts          PURE shouldIndexFile / detectLanguage / isIndexableContent
  indexing/chunker.ts         PURE chunkFile / embeddingText
  indexing/embeddings.ts      Voyage client (batching + backoff)
  indexing/indexer.ts         indexRepository (incremental, resumable, claim-locked)
  review/context.ts           retrieveContext; PURE queryForChange / selectContext
  review/pipeline.ts          background review pipeline
scripts/smoke-test.ts         env + Supabase + GitHub App checks (uses lib clients)
scripts/index-repo.ts         npm run index-repo -- owner/name [ref]  (no time budget)
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
`VOYAGE_API_KEY` (P3, now required for context). Later: `ANTHROPIC_API_KEY` (P4).

## 8. Commands

| Command | Does |
|---|---|
| `npm run dev` | dev server (regenerates `AGENTS.md`) |
| `npm run build` | production build |
| `npm test` | unit tests |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | static checks |
| `npm run smoke-test` | live check of env + Supabase + GitHub App |
| `npm run index-repo -- owner/name [ref]` | index one repo now, no time budget |
