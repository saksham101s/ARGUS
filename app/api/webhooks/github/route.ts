import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/github/verify';
import { getInstallationClient } from '@/lib/github/app';
import { getSupabaseClient } from '@/lib/db/client';

/**
 * GitHub webhook handler.
 *
 * Receives events from the Argus GitHub App and processes them.
 * Currently handles: pull_request (opened, synchronize)
 *
 * Key design decisions:
 * - Read raw body BEFORE parsing — signature verification needs exact bytes
 * - Respond fast (202) after DB insert — no LLM/Semgrep calls here
 * - Upsert installation + repo rows to handle first-time events gracefully
 *
 * Debugging tip: GitHub App settings → Advanced → Recent Deliveries
 * has a "Redeliver" button — useful for re-testing without opening new PRs.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // ── 1. Read raw body bytes ──────────────────────────────────────────
  // Must happen before any JSON parsing — signature verification
  // needs the exact bytes GitHub sent, not a re-serialized object.
  const rawBody = Buffer.from(await request.arrayBuffer());

  // ── 2. Verify webhook signature ─────────────────────────────────────
  const signature = request.headers.get('x-hub-signature-256');
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!signature || !secret) {
    console.error('[webhook] Missing signature header or GITHUB_WEBHOOK_SECRET');
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 401 },
    );
  }

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.error('[webhook] Signature verification failed');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 },
    );
  }

  // ── 3. Parse event type and payload ─────────────────────────────────
  const event = request.headers.get('x-github-event');
  const deliveryId = request.headers.get('x-github-delivery');
  const payload = JSON.parse(rawBody.toString('utf-8'));

  console.log(
    `[webhook] event=${event} action=${payload.action ?? 'n/a'} delivery=${deliveryId}`,
  );

  // ── 4. Route by event type ──────────────────────────────────────────
  // Only act on pull_request events with action opened or synchronize.
  // Everything else gets a fast 200 to prevent GitHub retries.
  if (event !== 'pull_request') {
    console.log(`[webhook] Ignoring event type: ${event}`);
    return NextResponse.json({ status: 'ignored', event });
  }

  const { action } = payload;
  if (action !== 'opened' && action !== 'synchronize') {
    console.log(`[webhook] Ignoring pull_request action: ${action}`);
    return NextResponse.json({ status: 'ignored', event, action });
  }

  // ── 5. Extract payload fields ───────────────────────────────────────
  const installationId = payload.installation?.id;
  const repoFullName = payload.repository?.full_name;
  const repoId = payload.repository?.id;
  const prNumber = payload.pull_request?.number;
  const commitSha = payload.pull_request?.head?.sha;
  const accountLogin = payload.installation?.account?.login;
  const accountType = payload.installation?.account?.type;
  const defaultBranch = payload.repository?.default_branch ?? 'main';

  if (!installationId || !repoFullName || !prNumber || !commitSha) {
    console.error('[webhook] Missing required payload fields', {
      installationId,
      repoFullName,
      prNumber,
      commitSha,
    });
    return NextResponse.json(
      { error: 'Missing required payload fields' },
      { status: 400 },
    );
  }

  const [owner, repo] = repoFullName.split('/');

  console.log(
    `[webhook] Processing PR #${prNumber} on ${repoFullName} (action=${action}, sha=${commitSha.slice(0, 7)})`,
  );

  try {
    // ── 6. Fetch changed files ──────────────────────────────────────────
    // Handle pagination — don't silently drop files past the first 100.
    const octokit = await getInstallationClient(installationId);

    const changedFiles = await octokit.paginate(
      octokit.pulls.listFiles,
      {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      },
    );

    // NOTE: Very large diffs won't have a `patch` field on the file object.
    // That's a Phase 4 problem — when it matters for review quality, we'll
    // need to fetch the full file content via the contents API instead.

    // Slim down the payload to what we actually need for now
    const changedFilesData = changedFiles.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null,
    }));

    console.log(
      `[webhook] Fetched ${changedFilesData.length} changed file(s) for PR #${prNumber}`,
    );

    // ── 7. Persist to database ────────────────────────────────────────
    const supabase = getSupabaseClient();

    // Upsert installation row (handles first-time events gracefully)
    const { error: instError } = await supabase
      .from('installations')
      .upsert(
        {
          id: installationId,
          account_login: accountLogin ?? owner,
          account_type: accountType ?? 'User',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

    if (instError) {
      console.error('[webhook] Failed to upsert installation', instError);
      throw instError;
    }

    // Upsert repository row
    const { error: repoError } = await supabase
      .from('repositories')
      .upsert(
        {
          id: repoId,
          installation_id: installationId,
          full_name: repoFullName,
          default_branch: defaultBranch,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

    if (repoError) {
      console.error('[webhook] Failed to upsert repository', repoError);
      throw repoError;
    }

    // Insert review row with changed files
    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .insert({
        repository_id: repoId,
        pr_number: prNumber,
        commit_sha: commitSha,
        status: 'pending',
        changed_files: changedFilesData,
      })
      .select('id')
      .single();

    if (reviewError) {
      console.error('[webhook] Failed to insert review', reviewError);
      throw reviewError;
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[webhook] Created review ${review.id} for PR #${prNumber} on ${repoFullName} ` +
        `(${changedFilesData.length} files, ${elapsed}ms)`,
    );

    // ── 8. Respond fast ───────────────────────────────────────────────
    // 202 Accepted — the review is queued, not yet processed.
    // Don't call the LLM or Semgrep from this handler.
    return NextResponse.json(
      {
        status: 'accepted',
        review_id: review.id,
        pr_number: prNumber,
        repo: repoFullName,
        files_count: changedFilesData.length,
      },
      { status: 202 },
    );
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(
      `[webhook] Error processing PR #${prNumber} on ${repoFullName} (${elapsed}ms)`,
      err,
    );

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
