import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkFile, embeddingText, MAX_LINES, TARGET_LINES } from './chunker';

const fn = (name: string, bodyLines: number) =>
  [
    `/** Docs for ${name}. */`,
    `export function ${name}() {`,
    ...Array.from({ length: bodyLines }, (_, i) => `  step${i}();`),
    '}',
    '',
  ].join('\n');

/** Every line of the file must appear in some chunk, in order. */
function assertCoversFile(content: string) {
  const chunks = chunkFile('x.ts', content);
  const lineCount = content
    .split('\n')
    .filter((l, i, a) => i < a.length - 1 || l !== '').length;
  let covered = 0;
  for (const c of chunks) {
    assert.ok(c.lineStart <= covered + 1, `gap before line ${c.lineStart}`);
    covered = Math.max(covered, c.lineEnd);
  }
  assert.ok(covered >= lineCount - 1, `covered ${covered} of ${lineCount}`);
  return chunks;
}

test('empty files produce no chunks', () => {
  assert.deepEqual(chunkFile('a.ts', ''), []);
  assert.deepEqual(chunkFile('a.ts', '\n\n  \n'), []);
});

test('a small file is a single chunk', () => {
  const chunks = chunkFile('a.ts', fn('a', 5));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].lineStart, 1);
});

test('splits at declarations and keeps doc comments with their function', () => {
  const content = fn('first', 40) + fn('second', 40) + fn('third', 40);
  const chunks = assertCoversFile(content);
  assert.ok(chunks.length >= 2);
  for (const c of chunks.slice(1)) {
    assert.match(
      c.content.split('\n')[0],
      /^\/\*\* Docs for/,
      'chunk starts at the doc comment',
    );
  }
});

test('keeps a multi-line JSDoc block with the function below it', () => {
  const jsdoc = (name: string) =>
    [
      '/**',
      ` * Docs for ${name}.`,
      ' * More detail.',
      ' */',
      `export function ${name}() {`,
    ]
      .concat(
        Array.from({ length: 50 }, () => '  work();'),
        ['}', ''],
      )
      .join('\n');
  const chunks = chunkFile('a.ts', jsdoc('one') + jsdoc('two'));
  assert.equal(chunks.length, 2);
  assert.match(chunks[1].content, /^\/\*\*\n \* Docs for two\./);
});

test('packs small declarations together up to the target size', () => {
  const content = Array.from({ length: 30 }, (_, i) => `export const c${i} = ${i};`).join(
    '\n',
  );
  const chunks = assertCoversFile(content);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].lineEnd - chunks[0].lineStart + 1 <= TARGET_LINES);
});

test('windows an oversized declaration with overlap', () => {
  const chunks = assertCoversFile(fn('huge', 300));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.lineEnd - c.lineStart + 1 <= MAX_LINES);
  assert.ok(chunks[1].lineStart <= chunks[0].lineEnd, 'windows overlap');
});

test('markdown splits at headings', () => {
  const section = (h: string) => `## ${h}\n` + 'text line\n'.repeat(40);
  const chunks = chunkFile(
    'README.md',
    section('One') + section('Two') + section('Three'),
  );
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.match(c.content, /^## /);
});

test('embedding text carries the path and line range', () => {
  const [chunk] = chunkFile('lib/auth.ts', fn('a', 3));
  assert.match(
    embeddingText('lib/auth.ts', chunk),
    /^File: lib\/auth\.ts \(lines 1-\d+\)\n\n/,
  );
});
