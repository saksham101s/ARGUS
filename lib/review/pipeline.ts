import { getInstallationClient } from '@/lib/github/app';
import { getIndexStatus } from '@/lib/db/code-index';
import { updateReview, type ChangedFile } from '@/lib/db/reviews';
import type { PullRequestInfo } from '@/lib/github/payloads';
import { indexRepository } from '@/lib/indexing/indexer';
import { retrieveContext } from './context';

/**
 * Share of the route's maxDuration (300s) a first-time index may use, so
 * retrieval (and Phase 4's review) still fit. A repo that doesn't finish is
 * left `partial` and resumes on the next PR or push.
 */
const INDEX_BUDGET_MS = 180_000;

/**
 * The review pipeline, run in the background after the webhook has
 * already answered GitHub (see `after()` in the webhook route).
 *
 * 1. fetch changed files              (Phase 2)
 * 2. ensure repo is indexed, retrieve related code from the rest of the
 *    repo, store as `reviews.context` (Phase 3)
 * Next: Claude review (P4) → Semgrep → post comments (P5).
 */
export async function runReviewPipeline(reviewId: string, pr: PullRequestInfo) {
  const tag = `[review ${reviewId.slice(0, 8)}]`;
  const startTime = Date.now();

  try {
    const changedFiles = await fetchChangedFiles(pr);
    await updateReview(reviewId, { changed_files: changedFiles });

    console.log(
      `${tag} Stored ${changedFiles.length} changed file(s) for ` +
        `${pr.repo.fullName}#${pr.number} (${Date.now() - startTime}ms)`,
    );

    await gatherContext(reviewId, pr, changedFiles, startTime + INDEX_BUDGET_MS);
  } catch (err) {
    console.error(`${tag} Pipeline failed`, err);
    await updateReview(reviewId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      completed_at: new Date().toISOString(),
    }).catch((e) => console.error(`${tag} Could not record failure`, e));
  }
}

/**
 * Non-fatal: without context the review can still run diff-only, so an
 * indexing or retrieval failure is logged (and recorded on the repo row by
 * the indexer) rather than failing the whole review.
 */
async function gatherContext(
  reviewId: string,
  pr: PullRequestInfo,
  changedFiles: ChangedFile[],
  deadline: number,
) {
  const tag = `[review ${reviewId.slice(0, 8)}]`;
  try {
    // Lazy indexing: a repo is indexed the first time it gets a PR. After
    // that, push events to the default branch keep it current.
    if ((await getIndexStatus(pr.repo.id)) !== 'ready') {
      await indexRepository(
        {
          id: pr.repo.id,
          owner: pr.repo.owner,
          name: pr.repo.name,
          installationId: pr.installation.id,
        },
        { ref: pr.repo.defaultBranch, deadline },
      );
    }

    const context = await retrieveContext(pr.repo.id, changedFiles);
    await updateReview(reviewId, { context });
    console.log(
      `${tag} Retrieved ${context.length} context chunk(s) from ` +
        `${new Set(context.map((c) => c.file_path)).size} file(s)`,
    );
  } catch (err) {
    console.error(`${tag} Context retrieval failed — review will be diff-only`, err);
  }
}

/**
 * Fetches every changed file, paginated. GitHub caps this endpoint at
 * 3000 files; PRs beyond that are truncated by GitHub itself.
 */
export async function fetchChangedFiles(pr: PullRequestInfo): Promise<ChangedFile[]> {
  const octokit = await getInstallationClient(pr.installation.id);

  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner: pr.repo.owner,
    repo: pr.repo.name,
    pull_number: pr.number,
    per_page: 100,
  });

  // `patch` is absent for binary and very large files. Phase 4 will fall
  // back to the contents API when that matters for review quality.
  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch ?? null,
    previous_filename: file.previous_filename ?? null,
  }));
}
