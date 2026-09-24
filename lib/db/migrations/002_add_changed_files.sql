-- Argus — Phase 2 Migration: add changed_files to reviews
-- Run this in the Supabase SQL Editor.

-- Store the changed-file list as JSON on the review row.
-- A dedicated table isn't needed until Phase 4 needs per-finding line mapping.
alter table reviews
  add column if not exists changed_files jsonb;
