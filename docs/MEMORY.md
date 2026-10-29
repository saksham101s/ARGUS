# Argus — Project Memory

> Running state of the project: where we are, what was decided and why,
> what's open. **Read this first every session; update it at the end of every
> session** (status, decisions, changelog). Architecture lives in
> [ARCHITECTURE.md](./ARCHITECTURE.md).

## Current status (2026-10-24)

| Phase | Scope | Status |
|---|---|---|
| 0–1 | Scaffold, GitHub App + OAuth App, DB schema, auth, smoke test | ✅ done, hardened 2026-10-23 |
| 2 | Webhook & diff pipeline | ✅ **done** — verified end-to-end in production on PR #1 (2026-10-24) |
| 3 | Codebase indexing & retrieval (RAG: chunking, Voyage embeddings, pgvector) | 🔧 code complete — **needs migration 004 + Push event + live test** |
| 4 | Review engine (Claude structured findings) | ⏳ |
| 5 | Semgrep + posting inline PR comments / check runs | ⏳ |
| 6 | Dashboard (repo list, review history, metrics) | ⏳ |
| 7 | Testing & refinement | ⏳ (unit tests started in Phase 2) |
| 8 | Docs & public launch (`docs/setup.md`, demo GIF, CONTRIBUTING) | ⏳ |

## Owner action items

- [x] Supabase project restored (2026-10-23); smoke test 3/3.
- [x] Migration 003 applied (verified: new `reviews` columns exist).
- [x] App installed on `saksham101s` (installation 174576465, 20 repos incl. ARGUS).
- [x] Phase 2 deployed to Vercel (392fd92); signed `ping` → `pong` verified.
- [x] Local `SUPABASE_SERVICE_ROLE_KEY` replaced with the secret key; smoke test 3/3.
- [x] 20 repos backfilled into `repositories` (ran the installation handler
      locally against the real `installation.created` payload).
- [x] Vercel env fixed (2026-10-24): redelivered `installation.created` →
      `200 {"status":"ok"}`; 20 active repos; smoke test 3/3.
- [x] Test PR opened (ARGUS PR #1, branch `testing`). Prod webhook → `202`,
      review row created with correct metadata ✅. Background step **failed**
      on Vercel: `error:1E08010C:DECODER routines::unsupported` — Vercel's
      `GITHUB_APP_PRIVATE_KEY` is in a shape OpenSSL can't parse (works locally).
- [x] PR #1 merged (b1e75c3). Prod redelivery of `synchronize` → `202`,
      failed review retried → `pending` with 7 changed files + patches.
      `opened` review correctly `superseded`; `closed` correctly ignored.
- [ ] **Phase 3:** run `lib/db/migrations/004_code_index.sql` in the SQL editor.
- [ ] **Phase 3:** GitHub App → Permissions & events → tick **Push** (keeps
      the index current). Unlike installation events, push is opt-in.
- [ ] **Phase 3:** add `VOYAGE_API_KEY` to Vercel env (it's set locally).
- [ ] Voyage free tier is ~3 requests/min without a payment method — indexing
      works (backoff) but is slow. Adding a card raises limits; the free
      token allowance still applies.
- [ ] Consider upgrading local Node to 22 (supabase-js deprecates Node 20).

Note: `installation` / `installation_repositories` events are delivered to
every GitHub App automatically — they are not checkboxes in the App's
event settings, and `GET /app` only lists `pull_request`. That's expected.

## Decisions (and why)

- **Background work via `after()`**, not a queue — simplest thing on Vercel.
  Webhook answers GitHub in ~DB-latency; file fetch runs after. Revisit in
  Phase 4 if reviews exceed `maxDuration` (300s) or need retries → candidates:
  a `pending`-review poller (Vercel Cron), Inngest, or a Supabase queue.
- **Idempotency by `(repository_id, pr_number, commit_sha)`** unique index,
  not by delivery id — retries/redeliveries of the same commit are no-ops.
- **Drafts are skipped**; reviewed on `ready_for_review`. Saves LLM cost.
  (Product call — flip in `lib/github/payloads.ts` if unwanted.)
- **Superseding**: a new commit marks older unfinished reviews of the same PR
  `superseded`. Phase 4 pipeline should check status before posting comments.
- **Uninstall/suspend deactivates repos instead of deleting** — keeps history.
- **RLS on, no policies** — service role only. If the dashboard ever reads
  Supabase from the browser, policies must be written first.
- **Tests use `node:test` + `tsx`**, no new dependency. Pure logic is split
  into `lib/github/payloads.ts` precisely so it's testable without mocks.
- **Phase 3 (defaults, owner may override):**
  - *Lazy indexing* — a repo is indexed on its first PR, not on install
    (20 repos × full index would burn embedding credits for repos that may
    never get a PR). `npm run index-repo` backfills on demand.
  - *Re-index on push to the default branch*, incremental by git blob sha.
  - *Git Trees + Blobs API* rather than tarball download: no new dependency,
    and blob shas give incremental indexing for free. Cost: one API request
    per changed file (fine under the 5000/h installation limit).
  - *Heuristic chunker* (column-0 declarations, ~60-line packing) instead of
    tree-sitter: language-agnostic, zero native deps. Swap-in point is
    `chunkFile`.
  - *voyage-code-3*, 1024-d (matches the existing schema), `document` vs
    `query` input types. Plain fetch, not the `voyageai` SDK (still in
    package.json, unused — can be removed).
  - *Retrieval excludes the changed files* — their new content is in the diff.
  - *Context is non-fatal*: no index / Voyage down → the review goes diff-only.
  - Index budget inside a review: 180s of the 300s route limit. Big repos
    finish over several runs (`partial` → resume).
- `reviews.changed_files` stays JSONB (no files table) until Phase 4 needs
  per-line mapping.

## Open questions for the owner

- Phase 3 defaults were chosen without the owner's plan (see Decisions) —
  owner may override any of them.
- Phase 4: which Claude model / cost ceiling per review? Max diff size before
  we skip or summarize?
- Phase 5: post as a single PR review with inline comments, or a Check Run
  with annotations, or both?
- Phase 6: dashboard scoping — show repos from installations the signed-in
  user can access (needs the OAuth access token → `GET /user/installations`).

## Known gaps / tech debt

- No migration runner; migrations are applied by hand.
- `findings` table exists but is unused (Phase 4).
- Files that produce zero chunks (empty/minified/binary) aren't recorded in
  the index, so they're re-downloaded on every index run. Cheap, but could
  store a sentinel row.
- Indexing time competes with Phase 4's LLM time inside one `after()`;
  revisit with a queue if first-PR reviews start timing out.
- Reviews stay `pending` after files are fetched (nothing consumes them yet).
- `patch` is null for binary/huge files — Phase 4 must fetch contents.
- README's `/docs/setup.md` link and `<your-username>` placeholders are unfilled.
- `lib/github/manifest.ts` URLs are localhost-only.

## Changelog

### 2026-10-24 — Phase 3: codebase indexing & retrieval (Claude)
- Migration 004: repo index state, chunk `blob_sha`/`chunk_index`/`language`,
  `reviews.context`, `match_code_chunks` RPC (service-role only).
- `lib/indexing/` filter, chunker, Voyage embeddings, incremental indexer;
  `lib/db/code-index.ts`; `lib/review/context.ts` retrieval.
- Pipeline: lazy index on first PR + context retrieval (non-fatal).
- `push` webhook → incremental re-index of indexed repos.
- Fix (2026-10-29): migration 004 failed in the SQL editor with `42501
  permission denied to set parameter "hnsw.ef_search"` — Supabase rejects
  it as a function `SET` attribute. Function is now plpgsql with a
  best-effort runtime `set_config`. Verified against the real DB inside a
  rolled-back transaction (migration OK, RPC OK, ef_search = 200, execute
  only for postgres/service_role).
- `npm run index-repo` CLI. Tests: 52. Dry run on this repo: 49 files →
  37 indexable → 67 chunks (median 40 lines). Found + fixed a JSDoc
  attachment bug in the chunker via the dry run.

### 2026-10-24 — First live PR test (Claude)
- PR #1 exposed a Vercel-only private-key parse failure. Added
  `lib/github/private-key.ts` (`normalizePrivateKey`): strips quotes, handles
  literal `\n`, space-collapsed and base64-encoded PEMs, re-wraps to canonical
  PEM, and throws an error naming `GITHUB_APP_PRIVATE_KEY` if still invalid.
- **Bug:** a failed review could never be retried — redelivery hit the
  duplicate check. `retryFailedReview` now resets `failed` → `pending`.
- Verified locally on the real PR #1 payload: retry → 1 changed file stored
  (patch included); second delivery → `duplicate`. Tests: 30.
- After merge, verified in production: retry path + key normalizer work on
  Vercel. **Phase 2 complete.**

### 2026-10-23 — Deploy check (Claude)
- Found `SUPABASE_SERVICE_ROLE_KEY` was the publishable key (RLS exposed it).
  `getSupabaseClient()` now rejects publishable/anon keys with a clear error,
  so the smoke test fails loudly instead of passing on empty reads.

### 2026-10-23 — Phase 1 hardening + Phase 2 completion (Claude)
Phase 1 fixes:
- **Bug:** `getSupabaseClient()` threw on Node 20 (no native WebSocket) —
  the webhook would 500 on every PR. Fixed with `ws` realtime transport;
  client is now memoized.
- **Security:** RLS enabled on all tables (were readable/writable with the
  public anon key).
- **Bug:** `verifyWebhookSignature` compared string length, not byte length —
  a multi-byte header made `timingSafeEqual` throw (500 instead of 401).
- PEM private key: literal `\n` sequences are normalized (Vercel-style env).
- Smoke test reuses the app's real clients, runs checks sequentially, lint clean.
- Prettier applied to all code files (README/DESIGN left untouched).

Phase 2:
- Webhook split into route (HTTP) / payloads (pure) / handlers / db / pipeline.
- Changed-file fetch moved to `after()` → fast 202.
- Idempotent review creation; older reviews superseded.
- Handles `reopened`, `ready_for_review`; skips drafts; `ping`; bad JSON → 400.
- `installation` + `installation_repositories` keep `repositories.is_active` in sync.
- Stores `pr_title`, `pr_author`, `head_ref`, `base_sha`, `previous_filename`.
- Migration 003. Unit tests (21) via `npm test`. Added `npm run typecheck`.

### 2026-09-24 — Phase 2 first cut, NextAuth v5 fix (owner)
### 2026-09-23 — Credentials wired, smoke test 3/3 (owner)
### 2026-09-22 — Scaffold (owner)
