-- Argus — Phase 2 Migration: webhook hardening
-- Run this in the Supabase SQL Editor after 002_add_changed_files.sql.

-- ── Row Level Security ─────────────────────────────────────────────────
-- Supabase exposes every public table through its REST API using the
-- public anon key. Without RLS, anyone holding that key could read or
-- write these tables. Enabling RLS with no policies locks them to the
-- service role, which is the only client Argus uses (lib/db/client.ts).
alter table installations enable row level security;
alter table repositories  enable row level security;
alter table reviews       enable row level security;
alter table findings      enable row level security;
alter table code_chunks   enable row level security;

-- ── PR metadata on reviews ─────────────────────────────────────────────
-- Needed by the review engine (base_sha for diffs, head_ref for context)
-- and the dashboard (title, author). `error` records why a review failed.
alter table reviews
  add column if not exists pr_title  text,
  add column if not exists pr_author text,
  add column if not exists head_ref  text,
  add column if not exists base_sha  text,
  add column if not exists error     text;

-- ── Idempotency ────────────────────────────────────────────────────────
-- GitHub retries deliveries and has a manual "Redeliver" button. One review
-- per (repo, PR, head commit) makes the webhook safe to replay.
-- Remove any duplicates created before this constraint existed (keeps the
-- oldest row for each commit).
delete from reviews r
using reviews keep
where r.repository_id = keep.repository_id
  and r.pr_number     = keep.pr_number
  and r.commit_sha    = keep.commit_sha
  and (r.created_at, r.id) > (keep.created_at, keep.id);

create unique index if not exists uq_reviews_repo_pr_sha
  on reviews(repository_id, pr_number, commit_sha);

-- Status values now: pending | in_progress | completed | failed | superseded
-- ('superseded' = a newer commit was pushed before this review finished.)
