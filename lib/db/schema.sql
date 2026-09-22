-- Argus — Initial Schema Migration
-- Run this in the Supabase SQL Editor after enabling pgvector.

-- ── Extensions ─────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── Installations ──────────────────────────────────────────────────────
-- Tracks each GitHub App installation (one per org/user account).
create table if not exists installations (
  id            bigint primary key,           -- GitHub installation ID
  account_login text        not null,         -- org or user login
  account_type  text        not null,         -- 'Organization' or 'User'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Repositories ───────────────────────────────────────────────────────
-- Repos that Argus is installed on.
create table if not exists repositories (
  id              bigint primary key,         -- GitHub repo ID
  installation_id bigint      not null references installations(id) on delete cascade,
  full_name       text        not null,       -- e.g. "acme/widget"
  default_branch  text        not null default 'main',
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_repositories_installation
  on repositories(installation_id);

-- ── Reviews ────────────────────────────────────────────────────────────
-- One row per PR review that Argus performs.
create table if not exists reviews (
  id            uuid primary key default gen_random_uuid(),
  repository_id bigint      not null references repositories(id) on delete cascade,
  pr_number     integer     not null,
  commit_sha    text        not null,
  status        text        not null default 'pending',  -- pending | in_progress | completed | failed
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_reviews_repository
  on reviews(repository_id);
create index if not exists idx_reviews_status
  on reviews(status);

-- ── Findings ───────────────────────────────────────────────────────────
-- Individual issues surfaced during a review.
create table if not exists findings (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid        not null references reviews(id) on delete cascade,
  category    text        not null,  -- e.g. 'bug', 'style', 'security', 'performance'
  severity    text        not null,  -- 'info' | 'warning' | 'critical'
  file        text        not null,  -- relative path in the repo
  line_start  integer,
  line_end    integer,
  message     text        not null,
  suggestion  text,                  -- optional fix suggestion
  created_at  timestamptz not null default now()
);

create index if not exists idx_findings_review
  on findings(review_id);
create index if not exists idx_findings_severity
  on findings(severity);

-- ── Code Chunks ────────────────────────────────────────────────────────
-- Indexed code chunks with vector embeddings for RAG retrieval.
create table if not exists code_chunks (
  id            uuid primary key default gen_random_uuid(),
  repository_id bigint      not null references repositories(id) on delete cascade,
  file_path     text        not null,
  line_start    integer     not null,
  line_end      integer     not null,
  content       text        not null,
  embedding     vector(1024),        -- Voyage AI embeddings dimension
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_code_chunks_repository
  on code_chunks(repository_id);
create index if not exists idx_code_chunks_file
  on code_chunks(repository_id, file_path);

-- HNSW index for vector similarity search (cosine distance)
create index if not exists idx_code_chunks_embedding
  on code_chunks
  using hnsw (embedding vector_cosine_ops);
