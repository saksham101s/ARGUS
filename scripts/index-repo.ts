/**
 * Index (or incrementally re-index) one repository from the command line,
 * with no time budget — for backfilling large repos and for debugging.
 *
 * Run: npm run index-repo -- owner/name [ref]
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

async function main() {
  const [fullName, ref] = process.argv.slice(2);
  if (!fullName?.includes('/')) {
    console.error('Usage: npm run index-repo -- owner/name [ref]');
    process.exit(1);
  }

  // Dynamic imports so dotenv has populated process.env first.
  const { getSupabaseClient } = await import('../lib/db/client');
  const { indexRepository } = await import('../lib/indexing/indexer');

  const { data: repo, error } = await getSupabaseClient()
    .from('repositories')
    .select('id, installation_id, full_name')
    .eq('full_name', fullName)
    .maybeSingle();
  if (error) throw error;
  if (!repo) {
    console.error(
      `${fullName} is not in the repositories table — is the App installed on it?`,
    );
    process.exit(1);
  }

  const [owner, name] = repo.full_name.split('/');
  const result = await indexRepository(
    { id: repo.id, owner, name, installationId: repo.installation_id },
    { ref },
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
