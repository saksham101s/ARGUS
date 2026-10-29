/**
 * One-screen health check of the live system: recent webhook deliveries,
 * recent reviews, and the code index state of every indexed repo.
 *
 * Run: npm run status
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

async function main() {
  const { getSupabaseClient } = await import('../lib/db/client');
  const { getAppClient } = await import('../lib/github/app');
  const sb = getSupabaseClient();

  console.log('─── Recent webhook deliveries (GitHub → Vercel) ───');
  const { data: deliveries } = await getAppClient().apps.listWebhookDeliveries({
    per_page: 10,
  });
  for (const d of deliveries) {
    const event = d.action ? `${d.event}.${d.action}` : d.event;
    const mark = d.status_code >= 500 ? '✗' : '✓';
    console.log(
      `  ${mark} ${d.delivered_at}  ${event.padEnd(32)} → ${d.status_code}${d.redelivery ? '  (redelivery)' : ''}`,
    );
  }

  console.log('\n─── Recent reviews ───');
  const { data: reviews, error: reviewsError } = await sb
    .from('reviews')
    .select(
      'id, pr_number, commit_sha, status, changed_files, context, error, repositories(full_name)',
    )
    .order('created_at', { ascending: false })
    .limit(8);
  if (reviewsError) throw reviewsError;
  if (!reviews?.length) console.log('  (none yet)');
  for (const r of reviews ?? []) {
    const repo =
      (r.repositories as unknown as { full_name: string } | null)?.full_name ?? '?';
    const files = Array.isArray(r.changed_files) ? r.changed_files.length : '—';
    const ctx = Array.isArray(r.context) ? r.context.length : '—';
    console.log(
      `  ${r.id.slice(0, 8)}  ${repo}#${r.pr_number} @${r.commit_sha.slice(0, 7)}  ` +
        `${r.status.padEnd(10)} files=${files} context=${ctx}${r.error ? `  error: ${r.error}` : ''}`,
    );
  }

  console.log('\n─── Code index ───');
  const { data: repos, error: reposError } = await sb
    .from('repositories')
    .select(
      'id, full_name, is_active, index_status, indexed_commit_sha, indexed_at, index_error',
    )
    .order('full_name');
  if (reposError) throw reposError;
  const active = repos?.filter((r) => r.is_active).length ?? 0;
  const indexed = repos?.filter((r) => r.index_status !== 'none') ?? [];
  console.log(`  ${active} active repo(s), ${indexed.length} with an index`);
  for (const r of indexed) {
    const { count } = await sb
      .from('code_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('repository_id', r.id);
    console.log(
      `  ${r.full_name.padEnd(36)} ${r.index_status.padEnd(9)} ${count} chunks` +
        `${r.indexed_commit_sha ? ` @${r.indexed_commit_sha.slice(0, 7)}` : ''}` +
        `${r.index_error ? `  error: ${r.index_error}` : ''}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
