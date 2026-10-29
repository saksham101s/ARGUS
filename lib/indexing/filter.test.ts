import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, isIndexableContent, shouldIndexFile } from './filter';

test('indexes ordinary source, config and docs', () => {
  for (const p of [
    'lib/auth.ts',
    'app/page.tsx',
    'src/main.py',
    'cmd/server/main.go',
    'lib/db/schema.sql',
    'README.md',
    'tsconfig.json',
    'Dockerfile',
  ]) {
    assert.equal(shouldIndexFile(p, 2_000), true, p);
  }
});

test('skips vendored, generated and build directories at any depth', () => {
  for (const p of [
    'node_modules/react/index.js',
    'packages/web/node_modules/x/y.ts',
    'dist/bundle.js',
    '.next/server/app.js',
    'vendor/github.com/x/y.go',
    'src/__pycache__/m.py',
  ]) {
    assert.equal(shouldIndexFile(p, 2_000), false, p);
  }
});

test('skips lockfiles, minified files, source maps and binaries', () => {
  for (const p of [
    'package-lock.json',
    'web/yarn.lock',
    'go.sum',
    'public/app.min.js',
    'public/app.js.map',
    'public/logo.png',
    'next-env.d.ts',
  ]) {
    assert.equal(shouldIndexFile(p, 2_000), false, p);
  }
});

test('enforces size limits, stricter for JSON', () => {
  assert.equal(shouldIndexFile('lib/big.ts', 150_000), false);
  assert.equal(shouldIndexFile('data/fixtures.json', 50_000), false);
  assert.equal(shouldIndexFile('lib/medium.ts', 50_000), true);
});

test('detects languages, ignoring notebooks', () => {
  assert.equal(detectLanguage('a/b.tsx'), 'typescript');
  assert.equal(detectLanguage('Makefile'), 'make');
  assert.equal(detectLanguage('nb.ipynb'), null);
  assert.equal(detectLanguage('LICENSE'), null);
});

test('rejects binary and minified content', () => {
  assert.equal(isIndexableContent('const a = 1;\nconst b = 2;\n'), true);
  assert.equal(isIndexableContent('PNG\0\0\0'), false);
  assert.equal(isIndexableContent('x'.repeat(5_000)), false);
});
