import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed } from './embeddings';

process.env.VOYAGE_API_KEY = 'test-key';

/**
 * Fake Voyage that 429s any request over `maxChars` total — like a
 * tokens-per-minute limit, which no amount of waiting can satisfy.
 * Tiny retry-after keeps the tests fast.
 */
function mockVoyage(maxChars: number, failFirstSmall = 0) {
  const calls: number[] = [];
  let smallFailures = 0;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body) as { input: string[] };
    calls.push(input.length);
    const chars = input.reduce((n, t) => n + t.length, 0);
    if (chars > maxChars || smallFailures++ < failFirstSmall) {
      return new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '0.001' },
      });
    }
    const data = input.map((text, index) => ({ index, embedding: [text.length] }));
    return Response.json({ data: data.reverse() }); // out of order on purpose
  }) as typeof fetch;
  return calls;
}

// ~3000 estimated tokens each (chars / 3); lengths differ to check order.
const texts = Array.from({ length: 5 }, (_, i) => 'x'.repeat(9_000 + i));

test('splits a batch too big for the rate limit and preserves input order', async () => {
  const calls = mockVoyage(20_000);
  const vectors = await embed(texts, 'document');
  assert.deepEqual(
    vectors.map((v) => v[0]),
    texts.map((t) => t.length),
  );
  assert.equal(calls[0], 5, 'first tries the whole batch');
  assert.ok(Math.max(...calls.slice(1)) <= 3, 'then retries in smaller batches');
});

test('does not split small batches on 429 — retries them whole', async () => {
  const calls = mockVoyage(Infinity, 2);
  const vectors = await embed(['a', 'bb', 'ccc'], 'document');
  assert.deepEqual(
    vectors.map((v) => v[0]),
    [1, 2, 3],
  );
  assert.deepEqual(calls, [3, 3, 3], 'same batch resent after each 429');
});

test('gives up with the API message on a non-retryable error', async () => {
  globalThis.fetch = (async () =>
    new Response('bad key', { status: 401 })) as typeof fetch;
  await assert.rejects(
    embed(['x'], 'query'),
    /Voyage embeddings failed \(401\): bad key/,
  );
});
