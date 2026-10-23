import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256).
 *
 * Uses HMAC-SHA256 with the webhook secret to verify the payload
 * hasn't been tampered with. Uses timing-safe comparison to prevent
 * timing attacks.
 *
 * @param payload - The raw request body bytes exactly as GitHub sent them
 * @param signature - The X-Hub-Signature-256 header value (sha256=...)
 * @param secret - The GITHUB_WEBHOOK_SECRET env var
 * @returns true if the signature is valid
 */
export function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
  );
  const received = Buffer.from(signature);

  // timingSafeEqual throws on unequal byte lengths. Compare bytes, not
  // string length — a multi-byte character would otherwise slip through.
  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}
