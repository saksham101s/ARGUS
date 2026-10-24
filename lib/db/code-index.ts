import { getSupabaseClient } from './client';
import type { Chunk } from '@/lib/indexing/chunker';

/** See migration 004 for what each state means. */
export type IndexStatus = 'none' | 'indexing' | 'ready' | 'partial' | 'failed';

/** An `indexing` claim older than this is assumed dead (crashed/timed out). */
const STALE_CLAIM_MS = 15 * 60 * 1000;

export async function getIndexStatus(repositoryId: number): Promise<IndexStatus | null> {
  const { data, error } = await getSupabaseClient()
    .from('repositories')
    .select('index_status')
    .eq('id', repositoryId)
    .maybeSingle();
  if (error) throw error;
  return (data?.index_status as IndexStatus) ?? null;
}

/**
 * Atomically marks the repo as `indexing`. Returns false if another run
 * holds a fresh claim — two PRs opened at once must not index twice.
 */
export async function claimIndexing(repositoryId: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data, error } = await getSupabaseClient()
    .from('repositories')
    .update({
      index_status: 'indexing' satisfies IndexStatus,
      index_started_at: new Date().toISOString(),
      index_error: null,
    })
    .eq('id', repositoryId)
    .or(`index_status.neq.indexing,index_started_at.lt.${staleBefore}`)
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function finishIndexing(
  repositoryId: number,
  result:
    | { status: 'ready' | 'partial'; commitSha: string }
    | { status: 'failed'; error: string },
) {
  const fields =
    result.status === 'failed'
      ? { index_status: result.status, index_error: result.error }
      : {
          index_status: result.status,
          indexed_commit_sha: result.commitSha,
          indexed_at: new Date().toISOString(),
          index_error: null,
        };
  const { error } = await getSupabaseClient()
    .from('repositories')
    .update(fields)
    .eq('id', repositoryId);
  if (error) throw error;
}

/** path → blob sha of every file currently in the index. */
export async function getIndexedFiles(
  repositoryId: number,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const pageSize = 1000;

  // Paginate: PostgREST caps responses at 1000 rows by default.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from('code_chunks')
      .select('file_path, blob_sha')
      .eq('repository_id', repositoryId)
      .eq('chunk_index', 0)
      .order('file_path')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) files.set(row.file_path, row.blob_sha);
    if (!data || data.length < pageSize) break;
  }

  return files;
}

export interface IndexedFile {
  path: string;
  blobSha: string;
  language: string;
  chunks: Chunk[];
  embeddings: number[][];
}

/**
 * Replaces all chunks of one file. Delete-then-insert rather than upsert:
 * a file can shrink to fewer chunks, and stale trailing chunks must go.
 */
export async function replaceFileChunks(repositoryId: number, file: IndexedFile) {
  await deleteFileChunks(repositoryId, [file.path]);
  if (file.chunks.length === 0) return;

  const rows = file.chunks.map((chunk, i) => ({
    repository_id: repositoryId,
    file_path: file.path,
    chunk_index: i,
    line_start: chunk.lineStart,
    line_end: chunk.lineEnd,
    content: chunk.content,
    language: file.language,
    blob_sha: file.blobSha,
    embedding: JSON.stringify(file.embeddings[i]),
  }));

  const { error } = await getSupabaseClient().from('code_chunks').insert(rows);
  if (error) throw error;
}

export async function deleteFileChunks(repositoryId: number, paths: string[]) {
  // Chunked so the `in` filter stays well under URL length limits.
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await getSupabaseClient()
      .from('code_chunks')
      .delete()
      .eq('repository_id', repositoryId)
      .in('file_path', paths.slice(i, i + 100));
    if (error) throw error;
  }
}

export interface ChunkMatch {
  id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  content: string;
  similarity: number;
}

export async function matchChunks(
  repositoryId: number,
  embedding: number[],
  count: number,
  excludePaths: string[],
): Promise<ChunkMatch[]> {
  const { data, error } = await getSupabaseClient().rpc('match_code_chunks', {
    p_repository_id: repositoryId,
    p_embedding: JSON.stringify(embedding),
    p_match_count: count,
    p_exclude_paths: excludePaths,
  });
  if (error) throw error;
  return (data ?? []) as ChunkMatch[];
}
