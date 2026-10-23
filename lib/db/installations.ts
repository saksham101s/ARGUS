import { getSupabaseClient } from './client';
import type { InstallationInfo, RepoInfo } from '@/lib/github/payloads';

export async function upsertInstallation(inst: InstallationInfo) {
  const { error } = await getSupabaseClient().from('installations').upsert(
    {
      id: inst.id,
      account_login: inst.accountLogin,
      account_type: inst.accountType,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/**
 * Upserts repos as active. `default_branch` is only written when known —
 * installation payloads omit it, and we don't want to clobber a real value.
 */
export async function activateRepositories(installationId: number, repos: RepoInfo[]) {
  if (repos.length === 0) return;

  const now = new Date().toISOString();
  const rows = repos.map((repo) => ({
    id: repo.id,
    installation_id: installationId,
    full_name: repo.fullName,
    is_active: true,
    updated_at: now,
    ...(repo.defaultBranch && { default_branch: repo.defaultBranch }),
  }));

  // PostgREST bulk upserts need uniform keys, so split by shape.
  const withBranch = rows.filter((r) => 'default_branch' in r);
  const withoutBranch = rows.filter((r) => !('default_branch' in r));

  for (const batch of [withBranch, withoutBranch]) {
    if (batch.length === 0) continue;
    const { error } = await getSupabaseClient()
      .from('repositories')
      .upsert(batch, { onConflict: 'id' });
    if (error) throw error;
  }
}

export async function deactivateRepositories(
  installationId: number,
  repoIds: number[] | 'all',
) {
  let query = getSupabaseClient()
    .from('repositories')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('installation_id', installationId);

  if (repoIds !== 'all') {
    if (repoIds.length === 0) return;
    query = query.in('id', repoIds);
  }

  const { error } = await query;
  if (error) throw error;
}
