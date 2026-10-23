import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { verifyWebhookSignature } from './verify';

const secret = 'test-secret';
const body = Buffer.from('{"action":"opened"}');
const sign = (payload: Buffer, key = secret) =>
  `sha256=${createHmac('sha256', key).update(payload).digest('hex')}`;

test('accepts a correct signature', () => {
  assert.equal(verifyWebhookSignature(body, sign(body), secret), true);
});

test('rejects a signature made with the wrong secret', () => {
  assert.equal(verifyWebhookSignature(body, sign(body, 'nope'), secret), false);
});

test('rejects a tampered body', () => {
  const tampered = Buffer.from('{"action":"closed"}');
  assert.equal(verifyWebhookSignature(tampered, sign(body), secret), false);
});

test('rejects malformed signatures without throwing', () => {
  assert.equal(verifyWebhookSignature(body, 'sha256=short', secret), false);
  assert.equal(verifyWebhookSignature(body, '', secret), false);
});

test('rejects same-length signatures with multi-byte characters', () => {
  const valid = sign(body);
  const multiByte = valid.slice(0, -1) + 'é'; // same string length, more bytes
  assert.equal(verifyWebhookSignature(body, multiByte, secret), false);
});
