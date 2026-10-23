import { after, NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/github/verify';
import {
  handleInstallation,
  handlePullRequest,
  type HandlerResult,
} from '@/lib/github/handlers';
import type { WebhookPayload } from '@/lib/github/payloads';

// Background work scheduled with `after()` shares this budget. Phase 4's
// LLM calls will need most of it; revisit if reviews start timing out.
export const maxDuration = 300;

/**
 * GitHub webhook endpoint.
 *
 * Handles:
 * - pull_request (opened, reopened, synchronize, ready_for_review)
 * - installation, installation_repositories (keeps the repo list in sync)
 * - ping (sent once when the webhook is created)
 *
 * Key design decisions:
 * - Read raw body BEFORE parsing — signature verification needs exact bytes
 * - Respond fast: only DB writes happen before the response; fetching
 *   files (and later the LLM review) runs in `after()`
 * - Idempotent: one review per (repo, PR, head sha), so redeliveries are safe
 *
 * Debugging tip: GitHub App settings → Advanced → Recent Deliveries
 * has a "Redeliver" button — useful for re-testing without opening new PRs.
 */
export async function POST(request: NextRequest) {
  // ── 1. Read raw body and verify signature ──────────────────────────
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get('x-hub-signature-256');
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[webhook] GITHUB_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!signature || !verifyWebhookSignature(rawBody, signature, secret)) {
    console.error('[webhook] Missing or invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // ── 2. Parse ───────────────────────────────────────────────────────
  const event = request.headers.get('x-github-event');
  const deliveryId = request.headers.get('x-github-delivery');

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log(
    `[webhook] event=${event} action=${payload.action ?? 'n/a'} delivery=${deliveryId}`,
  );

  // ── 3. Dispatch ────────────────────────────────────────────────────
  const startTime = Date.now();
  let result: HandlerResult;

  try {
    switch (event) {
      case 'ping':
        result = { status: 200, body: { status: 'pong' } };
        break;
      case 'pull_request':
        result = await handlePullRequest(payload);
        break;
      case 'installation':
      case 'installation_repositories':
        result = await handleInstallation(event, payload);
        break;
      default:
        result = { status: 200, body: { status: 'ignored', event } };
    }
  } catch (err) {
    // A 5xx shows up as a failed delivery in GitHub; redelivery is safe
    // because every write is an upsert.
    console.error(
      `[webhook] Error handling ${event} delivery=${deliveryId} (${Date.now() - startTime}ms)`,
      err,
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (result.background) {
    after(result.background);
  }

  return NextResponse.json(result.body, { status: result.status });
}
