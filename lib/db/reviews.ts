import { getSupabaseClient } from './client';
import type { PullRequestInfo } from '@/lib/github/payloads';

/**
 * Review lifecycle:
 *   pending → in_progress → completed
 *                         ↘ failed
 *   pending / in_progress → superseded (a newer commit arrived)
 */
export type ReviewStatus =
  'pending' | 'in_progress' | 'completed' | 'failed' | 'superseded';

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  /** null when GitHub omits the patch (binary or very large files). */
  patch: string | null;
  previous_filename: string | null;
}

/**
 * Creates the pending review row for a PR head commit.
 *
 * Returns null if a review for this exact commit already exists — GitHub
 * retries and manual redeliveries must not produce duplicate reviews
 * (enforced by uq_reviews_repo_pr_sha, migration 003).
 */
export async function createPendingReview(
  pr: PullRequestInfo,
): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseClient()
    .from('reviews')
    .upsert(
      {
        repository_id: pr.repo.id,
        pr_number: pr.number,
        commit_sha: pr.headSha,
        status: 'pending' satisfies ReviewStatus,
        pr_title: pr.title,
        pr_author: pr.author,
        head_ref: pr.headRef,
        base_sha: pr.baseSha,
      },
      {
        onConflict: 'repository_id,pr_number,commit_sha',
        ignoreDuplicates: true,
      },
    )
    .select('id');

  if (error) throw error;
  return data?.[0] ?? null;
}

/** Marks older unfinished reviews of the same PR as superseded. */
export async function supersedeOlderReviews(
  pr: PullRequestInfo,
  currentReviewId: string,
) {
  const { error } = await getSupabaseClient()
    .from('reviews')
    .update({ status: 'superseded' satisfies ReviewStatus })
    .eq('repository_id', pr.repo.id)
    .eq('pr_number', pr.number)
    .in('status', ['pending', 'in_progress'] satisfies ReviewStatus[])
    .neq('id', currentReviewId);
  if (error) throw error;
}

export async function updateReview(
  id: string,
  fields: {
    status?: ReviewStatus;
    changed_files?: ChangedFile[];
    started_at?: string;
    completed_at?: string;
    error?: string | null;
  },
) {
  const { error } = await getSupabaseClient().from('reviews').update(fields).eq('id', id);
  if (error) throw error;
}
