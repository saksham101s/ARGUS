import {
  parseInstallationEvent,
  parsePullRequestEvent,
  type WebhookPayload,
} from './payloads';
import {
  activateRepositories,
  deactivateRepositories,
  upsertInstallation,
} from '@/lib/db/installations';
import { createPendingReview, supersedeOlderReviews } from '@/lib/db/reviews';
import { runReviewPipeline } from '@/lib/review/pipeline';

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

  const review = await createPendingReview(pr);
  if (!review) {
    console.log(`[webhook] Review for ${label} already exists — skipping`);
    return {
      status: 200,
      body: { status: 'duplicate', pr_number: pr.number },
    };
  }

  // Non-fatal: if this threw, a redelivery would hit the duplicate path
  // above and the new review's pipeline would never be scheduled.
  await supersedeOlderReviews(pr, review.id).catch((err) =>
    console.error(`[webhook] Could not supersede older reviews of ${label}`, err),
  );
  console.log(`[webhook] Created review ${review.id} for ${label}`);

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
