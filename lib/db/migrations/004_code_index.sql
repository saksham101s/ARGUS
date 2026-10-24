-- Argus — Phase 3 Migration: codebase index + retrieval
-- Run this in the Supabase SQL Editor after 003_webhook_hardening.sql.

-- ── Per-repo index state ───────────────────────────────────────────────
-- index_status: none | indexing | ready | partial | failed
--   partial = ran out of time budget; the next run resumes where it stopped
--   (indexing is incremental by blob sha, so nothing is redone).
alter table repositories
  add column if not exists index_status       text not null default 'none',
  add column if not exists index_started_at   timestamptz,
  add column if not exists indexed_at         timestamptz,
  add column if not exists indexed_commit_sha text,
  add column if not exists index_error        text;

-- ── Chunk metadata ─────────────────────────────────────────────────────
-- blob_sha = the git blob the chunk came from. Comparing it with the
-- current tree tells us exactly which files changed since the last index.
alter table code_chunks
  add column if not exists blob_sha    text,
  add column if not exists chunk_index integer not null default 0,
  add column if not exists language    text;

create unique index if not exists uq_code_chunks_file_chunk
  on code_chunks(repository_id, file_path, chunk_index);

-- ── Retrieved context on reviews ───────────────────────────────────────
-- The chunks retrieval picked for this review (path, lines, similarity,
-- content). Consumed by the Phase 4 review engine; also explains to the
-- dashboard *why* Argus looked at a file.
alter table reviews
  add column if not exists context jsonb;

-- ── Similarity search ──────────────────────────────────────────────────
-- PostgREST can't express vector operators, so retrieval goes through RPC.
-- ef_search is raised because the repository_id filter is applied after
-- the HNSW scan: with many repos indexed, the default (40) can leave too
-- few candidates from the target repo.
create or replace function match_code_chunks(
  p_repository_id bigint,
  p_embedding     vector(1024),
  p_match_count   integer,
  p_exclude_paths text[] default '{}'
)
returns table (
  id         uuid,
  file_path  text,
  line_start integer,
  line_end   integer,
  content    text,
  similarity double precision
)
language sql stable
set hnsw.ef_search = 200
as $$
  select c.id, c.file_path, c.line_start, c.line_end, c.content,
         1 - (c.embedding <=> p_embedding) as similarity
  from code_chunks c
  where c.repository_id = p_repository_id
    and c.embedding is not null
    and not (c.file_path = any (p_exclude_paths))
  order by c.embedding <=> p_embedding
  limit p_match_count;
$$;

-- Supabase exposes public functions over REST to anon/authenticated by
-- default. Keep this server-only, like the tables (RLS, migration 003).
revoke execute on function match_code_chunks(bigint, vector, integer, text[])
  from public, anon, authenticated;
grant execute on function match_code_chunks(bigint, vector, integer, text[])
  to service_role;
