# Argus — Project Memory

> Running state of the project: where we are, what was decided and why,
> what's open. **Read this first every session; update it at the end of every
> session** (status, decisions, changelog). Architecture lives in
> [ARCHITECTURE.md](./ARCHITECTURE.md).

## Current status (2026-10-23)

| Phase | Scope | Status |
|---|---|---|
| 0–1 | Scaffold, GitHub App + OAuth App, DB schema, auth, smoke test | ✅ done, hardened 2026-10-23 |
| 2 | Webhook & diff pipeline | ✅ code complete — **needs migration 003 run + live test** |
| 3 | Codebase indexing & retrieval (RAG: chunking, Voyage embeddings, pgvector) | ⏳ not started — waiting on owner's detailed plan |
| 4 | Review engine (Claude structured findings) | ⏳ |
| 5 | Semgrep + posting inline PR comments / check runs | ⏳ |
| 6 | Dashboard (repo list, review history, metrics) | ⏳ |
| 7 | Testing & refinement | ⏳ (unit tests started in Phase 2) |
| 8 | Docs & public launch (`docs/setup.md`, demo GIF, CONTRIBUTING) | ⏳ |

## Owner action items

- [x] Supabase project restored (2026-10-23); smoke test 3/3.
- [x] Migration 003 applied (verified: new `reviews` columns exist).
- [x] App installed on `saksham101s` (installation 174576465, 20 repos incl. ARGUS).
- [ ] **Deploy Phase 2 code.** The App's webhook URL points at Vercel
      (`argus-sooty-eight.vercel.app`), which still runs commit 588a850 — it
      answered the `installation.created` delivery with "ignored", so the DB
      has 0 rows. After deploying: GitHub App → Advanced → Recent Deliveries →
      **Redeliver** that `installation.created` to backfill all 20 repos.
- [ ] Confirm Vercel has all env vars from `.env.example` set.
- [ ] Open a test PR on a repo to exercise the full Phase 2 path.
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
- `reviews.changed_files` stays JSONB (no files table) until Phase 4 needs
  per-line mapping.

## Open questions for the owner

- Phase 3: index on install (full repo) vs lazily on first PR? Re-index on
  push to default branch? Chunking strategy (by function/AST vs fixed lines)?
- Phase 4: which Claude model / cost ceiling per review? Max diff size before
  we skip or summarize?
- Phase 5: post as a single PR review with inline comments, or a Check Run
  with annotations, or both?
- Phase 6: dashboard scoping — show repos from installations the signed-in
  user can access (needs the OAuth access token → `GET /user/installations`).

## Known gaps / tech debt

- No migration runner; migrations are applied by hand.
- `findings` / `code_chunks` tables exist but are unused.
- Reviews stay `pending` after files are fetched (nothing consumes them yet).
- `patch` is null for binary/huge files — Phase 4 must fetch contents.
- README's `/docs/setup.md` link and `<your-username>` placeholders are unfilled.
- `lib/github/manifest.ts` URLs are localhost-only.

## Changelog

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
