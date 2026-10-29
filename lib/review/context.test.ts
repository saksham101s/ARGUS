import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickQueryFiles,
  queryForChange,
  selectContext,
  type ContextChunk,
} from './context';
import type { ChangedFile } from '@/lib/db/reviews';

const file = (overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  filename: 'lib/auth.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -1,3 +1,4 @@\n import x;\n-old();\n+newCall();\n+another();\n context();',
  previous_filename: null,
  ...overrides,
});

test('query keeps added + context lines, drops removed lines and hunk headers', () => {
  const q = queryForChange(file())!;
  assert.match(q, /^File: lib\/auth\.ts\n\n/);
  assert.match(q, /newCall\(\);/);
  assert.match(q, /context\(\);/);
  assert.doesNotMatch(q, /old\(\)/);
  assert.doesNotMatch(q, /@@/);
});

test('no query for removed files or files without a patch', () => {
  assert.equal(queryForChange(file({ status: 'removed' })), null);
  assert.equal(queryForChange(file({ patch: null })), null);
});

const chunk = (
  path: string,
  line: number,
  similarity: number,
  size = 100,
): ContextChunk => ({
  file_path: path,
  line_start: line,
  line_end: line + 10,
  similarity,
  content: 'x'.repeat(size),
  matched_from: 'lib/auth.ts',
});

test('dedupes by chunk, keeping the best similarity, ranked descending', () => {
  const out = selectContext([
    chunk('a.ts', 1, 0.5),
    chunk('a.ts', 1, 0.8),
    chunk('b.ts', 1, 0.6),
  ]);
  assert.deepEqual(
    out.map((c) => [c.file_path, c.similarity]),
    [
      ['a.ts', 0.8],
      ['b.ts', 0.6],
    ],
  );
});

test('drops low-similarity matches', () => {
  assert.deepEqual(selectContext([chunk('a.ts', 1, 0.1)]), []);
});

test('respects the chunk-count and character budgets', () => {
  const many = Array.from({ length: 40 }, (_, i) => chunk(`f${i}.ts`, 1, 0.9 - i * 0.01));
  assert.equal(selectContext(many).length, 15);

  const big = Array.from({ length: 5 }, (_, i) => chunk(`g${i}.ts`, 1, 0.9, 12_000));
  assert.equal(selectContext(big).length, 2);
});

test('queries come from code files, largest first; docs only if docs-only', () => {
  const files = [
    file({ filename: 'README.md', changes: 50 }),
    file({ filename: 'lib/a.ts', changes: 3 }),
    file({ filename: 'lib/b.ts', changes: 9 }),
  ];
  assert.deepEqual(
    pickQueryFiles(files).map((f) => f.filename),
    ['lib/b.ts', 'lib/a.ts'],
  );
  assert.deepEqual(
    pickQueryFiles([file({ filename: 'docs/x.md' })]).map((f) => f.filename),
    ['docs/x.md'],
  );
});
