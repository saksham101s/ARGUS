import { matchChunks } from '@/lib/db/code-index';
import type { ChangedFile } from '@/lib/db/reviews';
import { embed } from '@/lib/indexing/embeddings';

/** One retrieved snippet of the codebase, stored on `reviews.context`. */
export interface ContextChunk {
  file_path: string;
  line_start: number;
  line_end: number;
  similarity: number;
  content: string;
  /** The changed file whose diff pulled this chunk in. */
  matched_from: string;
}

/** Only the largest changes get their own query — keeps cost bounded. */
const MAX_QUERY_FILES = 20;
const MATCHES_PER_QUERY = 8;
const MAX_QUERY_CHARS = 6_000;
/** Below this, matches are mostly noise for voyage-code-3. */
const MIN_SIMILARITY = 0.35;
/** Total budget handed to the Phase 4 prompt. */
const MAX_CONTEXT_CHUNKS = 15;
const MAX_CONTEXT_CHARS = 30_000;

/**
 * Builds the retrieval query for a changed file: its path plus the lines
 * that exist after the change (added + unchanged context). Removed lines
 * are dropped — we want code related to what the PR *introduces*.
 * Pure; exported for tests.
 */
export function queryForChange(file: ChangedFile): string | null {
  if (file.status === 'removed' || !file.patch) return null;

  const lines = file.patch
    .split('\n')
    .filter((l) => !l.startsWith('-') && !l.startsWith('@@') && !l.startsWith('\\'))
    .map((l) => (l.startsWith('+') || l.startsWith(' ') ? l.slice(1) : l));

  const body = lines.join('\n').trim();
  if (!body) return null;
  return `File: ${file.filename}\n\n${body}`.slice(0, MAX_QUERY_CHARS);
}

/**
 * Merges per-query matches: one entry per chunk (best similarity wins),
 * thresholded, ranked, and cut to the context budget. Pure; exported for tests.
 */
export function selectContext(matches: ContextChunk[]): ContextChunk[] {
  const best = new Map<string, ContextChunk>();
  for (const m of matches) {
    if (m.similarity < MIN_SIMILARITY) continue;
    const key = `${m.file_path}:${m.line_start}`;
    const existing = best.get(key);
    if (!existing || m.similarity > existing.similarity) best.set(key, m);
  }

  const selected: ContextChunk[] = [];
  let chars = 0;
  for (const chunk of [...best.values()].sort((a, b) => b.similarity - a.similarity)) {
    if (selected.length >= MAX_CONTEXT_CHUNKS) break;
    if (chars + chunk.content.length > MAX_CONTEXT_CHARS) continue;
    selected.push(chunk);
    chars += chunk.content.length;
  }
  return selected;
}

/**
 * Finds code elsewhere in the repo related to what this PR changes.
 *
 * The changed files themselves are excluded: their new content is already
 * in the diff, and the index holds their *old* version. What the reviewer
 * lacks is everything else — callers, sibling implementations, helpers.
 */
export async function retrieveContext(
  repositoryId: number,
  changedFiles: ChangedFile[],
): Promise<ContextChunk[]> {
  const queries = [...changedFiles]
    .sort((a, b) => b.changes - a.changes)
    .map((file) => ({ file, text: queryForChange(file) }))
    .filter((q): q is { file: ChangedFile; text: string } => q.text !== null)
    .slice(0, MAX_QUERY_FILES);

  if (queries.length === 0) return [];

  const vectors = await embed(
    queries.map((q) => q.text),
    'query',
  );
  const exclude = changedFiles.flatMap((f) =>
    f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
  );

  const perQuery = await Promise.all(
    queries.map(async (q, i) => {
      const matches = await matchChunks(
        repositoryId,
        vectors[i],
        MATCHES_PER_QUERY,
        exclude,
      );
      return matches.map((m) => ({
        file_path: m.file_path,
        line_start: m.line_start,
        line_end: m.line_end,
        similarity: m.similarity,
        content: m.content,
        matched_from: q.file.filename,
      }));
    }),
  );

  return selectContext(perQuery.flat());
}
