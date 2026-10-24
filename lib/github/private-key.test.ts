import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'crypto';
import { normalizePrivateKey } from './private-key';

// GitHub App keys are PKCS#1 RSA ("BEGIN RSA PRIVATE KEY").
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();

const variants: Record<string, string> = {
  'a real multi-line PEM': pem,
  'literal \\n sequences': pem.replace(/\n/g, '\\n'),
  'wrapped in double quotes': `"${pem.replace(/\n/g, '\\n')}"`,
  'wrapped in single quotes': `'${pem}'`,
  'newlines collapsed to spaces': pem.replace(/\n/g, ' '),
  'CRLF line endings': pem.replace(/\n/g, '\r\n'),
  'base64-encoded PEM': Buffer.from(pem).toString('base64'),
};

for (const [name, raw] of Object.entries(variants)) {
  test(`normalizes ${name}`, () => {
    assert.equal(normalizePrivateKey(raw), pem);
  });
}

test('rejects a value with no PEM block, naming the env var', () => {
  assert.throws(
    () => normalizePrivateKey('not-a-key'),
    /GITHUB_APP_PRIVATE_KEY is not a PEM key/,
  );
});

test('rejects a truncated key body, naming the env var', () => {
  const truncated = pem.replace(/\n[A-Za-z0-9+/=]{64}\n/, '\n');
  assert.throws(
    () => normalizePrivateKey(truncated),
    /GITHUB_APP_PRIVATE_KEY could not be parsed/,
  );
});
