/**
 * Shows what context retrieval finds for a stored review's changed files —
 * the quickest way to judge retrieval quality on a real PR. Read-only: it
 * prints results and does not update the review.
 *
 * Run: npm run retrieve -- <review id or id prefix>
 *      (ids are shown by `npm run status`)
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

async function main() {
  const prefix = process.argv[2];
  if (!prefix) {
    console.error('Usage: npm run retrieve -- <review id or prefix>');
    process.exit(1);
  }

  const { getSupabaseClient } = await import('../lib/db/client');
  const { retrieveContext } = await import('../lib/review/context');

  // uuid columns can't be prefix-matched over REST; match recent ids locally.
  const { data: reviews, error } = await getSupabaseClient()
    .from('reviews')
    .select('id, repository_id, pr_number, changed_files')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const review = reviews?.find((r) => r.id.startsWith(prefix));
  if (!review) {
    console.error(`No recent review with id starting "${prefix}". Try: npm run status`);
    process.exit(1);
  }
  if (!Array.isArray(review.changed_files)) {
    console.error('That review has no changed files stored yet.');
    process.exit(1);
  }

  console.log(
    `PR #${review.pr_number}, changed: ` +
      review.changed_files.map((f: { filename: string }) => f.filename).join(', '),
  );

  const start = Date.now();
  const context = await retrieveContext(review.repository_id, review.changed_files);
  console.log(`\nRetrieved ${context.length} chunk(s) in ${Date.now() - start}ms:`);
  for (const c of context) {
    console.log(
      `  ${c.similarity.toFixed(3)}  ${c.file_path}:${c.line_start}-${c.line_end}   ← from ${c.matched_from}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
