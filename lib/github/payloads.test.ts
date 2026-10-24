import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstallationEvent,
  parsePullRequestEvent,
  parsePushEvent,
  type WebhookPayload,
} from './payloads';

const prPayload = (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
  action: 'opened',
  installation: { id: 1, account: { login: 'acme', type: 'Organization' } },
  repository: { id: 10, full_name: 'acme/widget', default_branch: 'trunk' },
  pull_request: {
    number: 42,
    title: 'Add thing',
    draft: false,
    user: { login: 'dev' },
    head: { sha: 'abc1234def', ref: 'feature' },
    base: { sha: 'base999' },
  },
  ...overrides,
});

test('parses a reviewable pull_request event', () => {
  const result = parsePullRequestEvent(prPayload());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.deepEqual(result.data.repo, {
    id: 10,
    fullName: 'acme/widget',
    defaultBranch: 'trunk',
    owner: 'acme',
    name: 'widget',
  });
  assert.equal(result.data.number, 42);
  assert.equal(result.data.headSha, 'abc1234def');
  assert.equal(result.data.baseSha, 'base999');
  assert.equal(result.data.author, 'dev');
});

for (const action of ['opened', 'reopened', 'synchronize', 'ready_for_review']) {
  test(`reviews action=${action}`, () => {
    assert.equal(parsePullRequestEvent(prPayload({ action })).kind, 'ok');
  });
}

for (const action of ['closed', 'labeled', 'edited', undefined]) {
  test(`ignores action=${action}`, () => {
    assert.equal(parsePullRequestEvent(prPayload({ action })).kind, 'ignore');
  });
}

test('ignores draft pull requests', () => {
  const payload = prPayload();
  payload.pull_request!.draft = true;
  assert.deepEqual(parsePullRequestEvent(payload), {
    kind: 'ignore',
    reason: 'draft pull request',
  });
});

test('rejects payloads missing required fields', () => {
  assert.equal(
    parsePullRequestEvent(prPayload({ installation: undefined })).kind,
    'invalid',
  );
  const noSha = prPayload();
  noSha.pull_request!.head = {};
  assert.equal(parsePullRequestEvent(noSha).kind, 'invalid');
});

const instPayload = (action: string): WebhookPayload => ({
  action,
  installation: { id: 7, account: { login: 'acme', type: 'Organization' } },
  repositories: [{ id: 1, full_name: 'acme/a' }],
  repositories_added: [{ id: 2, full_name: 'acme/b' }, { id: 3 }],
  repositories_removed: [{ id: 4, full_name: 'acme/d' }],
});

test('installation.created activates listed repos', () => {
  const result = parseInstallationEvent('installation', instPayload('created'));
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.deepEqual(
    result.data.reposToActivate.map((r) => r.id),
    [1],
  );
  assert.equal(result.data.deactivateAll, false);
});

for (const action of ['deleted', 'suspend']) {
  test(`installation.${action} deactivates all repos`, () => {
    const result = parseInstallationEvent('installation', instPayload(action));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.data.deactivateAll, true);
  });
}

test('installation_repositories adds/removes, skipping malformed repos', () => {
  const result = parseInstallationEvent(
    'installation_repositories',
    instPayload('added'),
  );
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.deepEqual(
    result.data.reposToActivate.map((r) => r.id),
    [2],
  );
  assert.deepEqual(
    result.data.reposToDeactivate.map((r) => r.id),
    [4],
  );
});

test('installation events without an id are invalid', () => {
  assert.equal(
    parseInstallationEvent('installation', { action: 'created' }).kind,
    'invalid',
  );
});

const pushPayload = (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
  ref: 'refs/heads/main',
  after: 'abc123',
  installation: { id: 7 },
  repository: { id: 10, full_name: 'acme/widget', default_branch: 'main' },
  ...overrides,
});

test('push to the default branch is accepted', () => {
  const result = parsePushEvent(pushPayload());
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.data.headSha, 'abc123');
  assert.equal(result.data.repo.owner, 'acme');
});

test('push to another branch or a branch deletion is ignored', () => {
  assert.equal(parsePushEvent(pushPayload({ ref: 'refs/heads/feature' })).kind, 'ignore');
  assert.equal(parsePushEvent(pushPayload({ ref: 'refs/tags/v1' })).kind, 'ignore');
  assert.equal(parsePushEvent(pushPayload({ deleted: true })).kind, 'ignore');
  assert.equal(parsePushEvent(pushPayload({ after: '0'.repeat(40) })).kind, 'ignore');
});

test('push without installation or repo is invalid', () => {
  assert.equal(parsePushEvent(pushPayload({ installation: undefined })).kind, 'invalid');
});
