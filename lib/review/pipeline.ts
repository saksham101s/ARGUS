import { getInstallationClient } from '@/lib/github/app';
import { updateReview, type ChangedFile } from '@/lib/db/reviews';
import type { PullRequestInfo } from '@/lib/github/payloads';

/**
 * The review pipeline, run in the background after the webhook has
 * already answered GitHub (see `after()` in the webhook route).
 *
 * Phase 2: fetch the changed files and store them on the review row.
 * Phase 3+ will extend this: retrieve repo context → Claude review →
 * Semgrep → post comments.
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
