/**
 * Webhook payload parsing — pure functions, no I/O.
 *
 * Only the fields Argus uses are typed. Everything is optional because the
 * payload is untrusted JSON; parsers validate before returning typed data.
 * Payload reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads
 */

interface AccountPayload {
  login?: string;
  type?: string;
}

interface RepoPayload {
  id?: number;
  full_name?: string;
  default_branch?: string;
}

export interface WebhookPayload {
  action?: string;
  installation?: { id?: number; account?: AccountPayload };
  repository?: RepoPayload;
  repositories?: RepoPayload[];
  repositories_added?: RepoPayload[];
  repositories_removed?: RepoPayload[];
  pull_request?: {
    number?: number;
    title?: string;
    draft?: boolean;
    user?: { login?: string };
    head?: { sha?: string; ref?: string };
    base?: { sha?: string };
  };
  // push
  ref?: string;
  after?: string;
  deleted?: boolean;
}

export interface InstallationInfo {
  id: number;
  accountLogin: string;
  accountType: string;
}

export interface RepoInfo {
  id: number;
  fullName: string;
  /** Absent in installation payloads — only PR payloads carry it. */
  defaultBranch?: string;
}

export interface PullRequestInfo {
  installation: InstallationInfo;
  repo: RepoInfo & { owner: string; name: string };
  number: number;
  title: string | null;
  author: string | null;
  headSha: string;
  headRef: string | null;
  baseSha: string | null;
}

export type Parsed<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'ignore'; reason: string }
  | { kind: 'invalid'; reason: string };

/**
 * PR actions that mean "there is new code to review".
 * - opened / reopened / synchronize: new or updated head commit
 * - ready_for_review: a draft became reviewable (drafts are skipped below)
 */
const REVIEWABLE_ACTIONS = new Set([
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
]);

function parseInstallation(payload: WebhookPayload): InstallationInfo | null {
  const inst = payload.installation;
  if (typeof inst?.id !== 'number') return null;
  return {
    id: inst.id,
    accountLogin: inst.account?.login ?? 'unknown',
    accountType: inst.account?.type ?? 'User',
  };
}

function parseRepo(repo: RepoPayload | undefined): RepoInfo | null {
  if (typeof repo?.id !== 'number' || !repo.full_name) return null;
  return {
    id: repo.id,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
  };
}

function parseRepoList(repos: RepoPayload[] | undefined): RepoInfo[] {
  return (repos ?? []).map(parseRepo).filter((r): r is RepoInfo => !!r);
}

export function parsePullRequestEvent(payload: WebhookPayload): Parsed<PullRequestInfo> {
  const action = payload.action ?? 'n/a';
  if (!REVIEWABLE_ACTIONS.has(action)) {
    return { kind: 'ignore', reason: `pull_request action: ${action}` };
  }

  const pr = payload.pull_request;
  if (pr?.draft) {
    return { kind: 'ignore', reason: 'draft pull request' };
  }

  const installation = parseInstallation(payload);
  const repo = parseRepo(payload.repository);
  const number = pr?.number;
  const headSha = pr?.head?.sha;

  if (!installation || !repo || typeof number !== 'number' || !headSha) {
    return { kind: 'invalid', reason: 'missing required payload fields' };
  }

  const [owner, name] = repo.fullName.split('/');

  return {
    kind: 'ok',
    data: {
      installation,
      repo: { ...repo, owner, name },
      number,
      title: pr?.title ?? null,
      author: pr?.user?.login ?? null,
      headSha,
      headRef: pr?.head?.ref ?? null,
      baseSha: pr?.base?.sha ?? null,
    },
  };
}

export interface InstallationChange {
  installation: InstallationInfo;
  reposToActivate: RepoInfo[];
  reposToDeactivate: RepoInfo[];
  /** Deactivate every repo under the installation (uninstall / suspend). */
  deactivateAll: boolean;
}

/**
 * Handles both `installation` and `installation_repositories` events, which
 * together tell us which repos Argus currently has access to.
 */
export function parseInstallationEvent(
  event: 'installation' | 'installation_repositories',
  payload: WebhookPayload,
): Parsed<InstallationChange> {
  const installation = parseInstallation(payload);
  if (!installation) {
    return { kind: 'invalid', reason: 'missing installation id' };
  }

  const base: InstallationChange = {
    installation,
    reposToActivate: [],
    reposToDeactivate: [],
    deactivateAll: false,
  };
  const action = payload.action ?? 'n/a';

  if (event === 'installation_repositories') {
    if (action !== 'added' && action !== 'removed') {
      return { kind: 'ignore', reason: `${event} action: ${action}` };
    }
    return {
      kind: 'ok',
      data: {
        ...base,
        reposToActivate: parseRepoList(payload.repositories_added),
        reposToDeactivate: parseRepoList(payload.repositories_removed),
      },
    };
  }

  switch (action) {
    case 'created':
    case 'unsuspend':
      // `repositories` is only present on `created`; unsuspend re-enables
      // nothing by itself — repos reactivate on their next PR event.
      return {
        kind: 'ok',
        data: {
          ...base,
          reposToActivate: parseRepoList(payload.repositories),
        },
      };
    case 'deleted':
    case 'suspend':
      // Deactivate rather than delete so review history survives.
      return {
        kind: 'ok',
        data: { ...base, deactivateAll: true },
      };
    default:
      return { kind: 'ignore', reason: `${event} action: ${action}` };
  }
}

export interface PushInfo {
  installationId: number;
  repo: RepoInfo & { owner: string; name: string };
  headSha: string;
}

/**
 * Only pushes to the default branch matter: that's what the index mirrors.
 * Feature-branch code reaches the reviewer through the PR diff instead.
 */
export function parsePushEvent(payload: WebhookPayload): Parsed<PushInfo> {
  // Push payloads carry only the installation id (no account), so this is
  // deliberately not parseInstallation — nothing here may upsert the
  // installation row with placeholder account data.
  const installationId = payload.installation?.id;
  const repo = parseRepo(payload.repository);
  if (typeof installationId !== 'number' || !repo || !repo.defaultBranch) {
    return { kind: 'invalid', reason: 'missing required payload fields' };
  }

  if (payload.ref !== `refs/heads/${repo.defaultBranch}`) {
    return { kind: 'ignore', reason: `push to non-default ref: ${payload.ref}` };
  }
  if (payload.deleted || !payload.after || /^0+$/.test(payload.after)) {
    return { kind: 'ignore', reason: 'branch deleted' };
  }

  const [owner, name] = repo.fullName.split('/');
  return {
    kind: 'ok',
    data: { installationId, repo: { ...repo, owner, name }, headSha: payload.after },
  };
}
