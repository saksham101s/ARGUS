import {
  parseInstallationEvent,
  parsePullRequestEvent,
  parsePushEvent,
  type WebhookPayload,
} from './payloads';
import {
  activateRepositories,
  deactivateRepositories,
  upsertInstallation,
} from '@/lib/db/installations';
import {
  createPendingReview,
  retryFailedReview,
  supersedeOlderReviews,
} from '@/lib/db/reviews';
import { getIndexStatus } from '@/lib/db/code-index';
import { indexRepository } from '@/lib/indexing/indexer';
import { runReviewPipeline } from '@/lib/review/pipeline';

/** Leaves headroom under the route's maxDuration (300s). */
const PUSH_INDEX_BUDGET_MS = 250_000;

/**
 * Webhook event handlers. Each returns the HTTP response to send GitHub and,
 * optionally, background work for the route to schedule with `after()` —
 * so handlers stay framework-agnostic and the response is never blocked on
 * GitHub API or LLM calls.
 */
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
  background?: () => Promise<void>;
}

const ignored = (reason: string): HandlerResult => ({
  // 200, not 4xx — an error would make GitHub flag the delivery as failed.
  status: 200,
  body: { status: 'ignored', reason },
});

const invalid = (reason: string): HandlerResult => ({
  status: 400,
  body: { error: reason },
});

export async function handlePullRequest(payload: WebhookPayload): Promise<HandlerResult> {
  const parsed = parsePullRequestEvent(payload);
  if (parsed.kind === 'ignore') return ignored(parsed.reason);
  if (parsed.kind === 'invalid') return invalid(parsed.reason);

  const pr = parsed.data;
  const label = `${pr.repo.fullName}#${pr.number}@${pr.headSha.slice(0, 7)}`;

  await upsertInstallation(pr.installation);
  await activateRepositories(pr.installation.id, [pr.repo]);

  const created = await createPendingReview(pr);
  const review = created ?? (await retryFailedReview(pr));
  if (!review) {
    console.log(`[webhook] Review for ${label} already exists — skipping`);
    return {
      status: 200,
      body: { status: 'duplicate', pr_number: pr.number },
    };
  }
  if (!created) console.log(`[webhook] Retrying failed review ${review.id} for ${label}`);

  // Non-fatal: if this threw, a redelivery would hit the duplicate path
  // above and the new review's pipeline would never be scheduled.
  await supersedeOlderReviews(pr, review.id).catch((err) =>
    console.error(`[webhook] Could not supersede older reviews of ${label}`, err),
  );
  if (created) console.log(`[webhook] Created review ${review.id} for ${label}`);

  return {
    status: 202,
    body: {
      status: 'accepted',
      review_id: review.id,
      pr_number: pr.number,
      repo: pr.repo.fullName,
    },
    background: () => runReviewPipeline(review.id, pr),
  };
}

export async function handleInstallation(
  event: 'installation' | 'installation_repositories',
  payload: WebhookPayload,
): Promise<HandlerResult> {
  const parsed = parseInstallationEvent(event, payload);
  if (parsed.kind === 'ignore') return ignored(parsed.reason);
  if (parsed.kind === 'invalid') return invalid(parsed.reason);

  const change = parsed.data;
  const instId = change.installation.id;

  await upsertInstallation(change.installation);
  await activateRepositories(instId, change.reposToActivate);
  await deactivateRepositories(
    instId,
    change.deactivateAll ? 'all' : change.reposToDeactivate.map((r) => r.id),
  );

  console.log(
    `[webhook] ${event}.${payload.action} for installation ${instId}: ` +
      `+${change.reposToActivate.length} repo(s), ` +
      (change.deactivateAll
        ? 'all repos deactivated'
        : `-${change.reposToDeactivate.length} repo(s)`),
  );

  return { status: 200, body: { status: 'ok', installation_id: instId } };
}

/**
 * Keeps the code index current: a push to the default branch re-indexes
 * the changed files (incremental — unchanged blobs are skipped).
 * Repos that were never indexed are left alone; indexing is lazy and
 * starts with the repo's first PR.
 */
export async function handlePush(payload: WebhookPayload): Promise<HandlerResult> {
  const parsed = parsePushEvent(payload);
  if (parsed.kind === 'ignore') return ignored(parsed.reason);
  if (parsed.kind === 'invalid') return invalid(parsed.reason);

  const push = parsed.data;
  const status = await getIndexStatus(push.repo.id);
  if (status === null || status === 'none') {
    return ignored('repository not indexed yet');
  }

  console.log(
    `[webhook] Push to ${push.repo.fullName}@${push.headSha.slice(0, 7)} — re-indexing`,
  );
  return {
    status: 202,
    body: { status: 'accepted', repo: push.repo.fullName },
    background: async () => {
      await indexRepository(
        {
          id: push.repo.id,
          owner: push.repo.owner,
          name: push.repo.name,
          installationId: push.installationId,
        },
        { ref: push.headSha, deadline: Date.now() + PUSH_INDEX_BUDGET_MS },
      ).catch(() => {
        // Already logged and recorded on the repo row by the indexer.
      });
    },
  };
}
