import { getInstallationClient } from '@/lib/github/app';
import {
  claimIndexing,
  deleteFileChunks,
  finishIndexing,
  getIndexedFiles,
  replaceFileChunks,
  type IndexedFile,
} from '@/lib/db/code-index';
import { CHUNKER_VERSION, chunkFile, embeddingText } from './chunker';
import { embed } from './embeddings';
import { detectLanguage, isIndexableContent, shouldIndexFile } from './filter';

/** Hard cap so one monorepo can't burn the whole embedding budget. */
export const MAX_FILES_PER_REPO = 3000;
/** Files fetched + embedded per round trip. */
const FILE_BATCH_SIZE = 20;
const BLOB_CONCURRENCY = 8;

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
  installationId: number;
}

export interface IndexResult {
  status: 'ready' | 'partial' | 'skipped';
  commitSha?: string;
  filesIndexed: number;
  filesDeleted: number;
  filesUnchanged: number;
  chunksWritten: number;
}

/**
 * Brings the repo's chunk index in line with `ref` (default: default branch).
 *
 * Incremental by design: every file's git blob sha is stored with its
 * chunks, so only files whose sha changed are re-fetched and re-embedded,
 * and files gone from the tree are deleted. The same code path does the
 * first full index and every later update.
 *
 * `deadline` (epoch ms) bounds the run. On timeout the repo is left
 * `partial`; the next run resumes, since finished files already match.
 */
export async function indexRepository(
  repo: RepoRef,
  opts: { ref?: string; deadline?: number } = {},
): Promise<IndexResult> {
  const tag = `[index ${repo.owner}/${repo.name}]`;
  const empty = { filesIndexed: 0, filesDeleted: 0, filesUnchanged: 0, chunksWritten: 0 };

  if (!(await claimIndexing(repo.id))) {
    console.log(`${tag} Another run is already indexing — skipping`);
    return { status: 'skipped', ...empty };
  }

  const startTime = Date.now();
  try {
    const octokit = await getInstallationClient(repo.installationId);

    // ── 1. Resolve the commit and list every file in its tree ─────────
    const ref =
      opts.ref ??
      (await octokit.repos.get({ owner: repo.owner, repo: repo.name })).data
        .default_branch;
    const { data: commit } = await octokit.repos.getCommit({
      owner: repo.owner,
      repo: repo.name,
      ref,
    });
    const { data: tree } = await octokit.git.getTree({
      owner: repo.owner,
      repo: repo.name,
      tree_sha: commit.commit.tree.sha,
      recursive: 'true',
    });
    if (tree.truncated) {
      console.warn(
        `${tag} Tree listing truncated by GitHub — indexing what was returned`,
      );
    }

    const wanted = new Map<string, string>(); // path → blob sha
    for (const entry of tree.tree) {
      if (entry.type !== 'blob' || !entry.path || !entry.sha) continue;
      if (!shouldIndexFile(entry.path, entry.size ?? 0)) continue;
      if (wanted.size >= MAX_FILES_PER_REPO) break;
      wanted.set(entry.path, entry.sha);
    }

    // ── 2. Diff against what's already indexed ────────────────────────
    const indexed = await getIndexedFiles(repo.id);
    const toIndex = [...wanted].filter(
      ([path, sha]) => indexed.get(path) !== indexKey(sha),
    );
    const toDelete = [...indexed.keys()].filter((path) => !wanted.has(path));

    console.log(
      `${tag} ${commit.sha.slice(0, 7)}: ${wanted.size} indexable, ` +
        `${toIndex.length} to (re)index, ${toDelete.length} to delete`,
    );

    await deleteFileChunks(repo.id, toDelete);

    // ── 3. Fetch → chunk → embed → store, in batches ──────────────────
    let filesIndexed = 0;
    let chunksWritten = 0;
    let timedOut = false;

    for (let i = 0; i < toIndex.length; i += FILE_BATCH_SIZE) {
      if (opts.deadline && Date.now() > opts.deadline) {
        timedOut = true;
        break;
      }

      const batch = toIndex.slice(i, i + FILE_BATCH_SIZE);
      const files = await mapConcurrent(batch, BLOB_CONCURRENCY, async ([path, sha]) => {
        const { data: blob } = await octokit.git.getBlob({
          owner: repo.owner,
          repo: repo.name,
          file_sha: sha,
        });
        const content = Buffer.from(blob.content, 'base64').toString('utf-8');
        // Non-indexable content still gets a (zero-chunk) entry so the
        // file's old chunks, if any, are cleared.
        const chunks = isIndexableContent(content) ? chunkFile(path, content) : [];
        return {
          path,
          blobSha: indexKey(sha),
          language: detectLanguage(path) ?? 'text',
          chunks,
        };
      });

      const texts = files.flatMap((f) => f.chunks.map((c) => embeddingText(f.path, c)));
      const vectors = texts.length > 0 ? await embed(texts, 'document') : [];

      let offset = 0;
      for (const file of files) {
        const indexedFile: IndexedFile = {
          ...file,
          embeddings: vectors.slice(offset, offset + file.chunks.length),
        };
        offset += file.chunks.length;
        await replaceFileChunks(repo.id, indexedFile);
        chunksWritten += file.chunks.length;
      }
      filesIndexed += files.length;
    }

    const status = timedOut ? 'partial' : 'ready';
    await finishIndexing(repo.id, { status, commitSha: commit.sha });

    console.log(
      `${tag} ${status}: ${filesIndexed} file(s), ${chunksWritten} chunk(s), ` +
        `${toDelete.length} deleted (${Date.now() - startTime}ms)`,
    );

    return {
      status,
      commitSha: commit.sha,
      filesIndexed,
      filesDeleted: toDelete.length,
      filesUnchanged: wanted.size - toIndex.length,
      chunksWritten,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Indexing failed`, err);
    await finishIndexing(repo.id, { status: 'failed', error: message }).catch((e) =>
      console.error(`${tag} Could not record failure`, e),
    );
    throw err;
  }
}

/**
 * What `code_chunks.blob_sha` stores: the git blob sha prefixed with the
 * chunker version, so a chunker change invalidates every file once.
 */
function indexKey(blobSha: string): string {
  return `v${CHUNKER_VERSION}:${blobSha}`;
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
