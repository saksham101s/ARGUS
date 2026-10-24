import { createPrivateKey } from 'crypto';

const PEM_RE = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/;

/**
 * Turns GITHUB_APP_PRIVATE_KEY into a PEM OpenSSL can parse, whatever shape
 * a hosting dashboard left it in. Seen in the wild (Vercel especially):
 * - wrapped in literal quotes
 * - newlines stored as literal "\n" sequences
 * - newlines collapsed into spaces when pasted into a single-line input
 * - the whole PEM base64-encoded (a common workaround for the above)
 *
 * The body is re-wrapped at 64 chars so all of these become a canonical PEM.
 * Throws an actionable error if the result still isn't a valid key — the raw
 * OpenSSL message ("DECODER routines::unsupported") doesn't say which env
 * var is wrong.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  key = key.replace(/\\r/g, '').replace(/\\n/g, '\n');

  if (!key.includes('-----BEGIN')) {
    key = Buffer.from(key, 'base64').toString('utf-8');
  }

  const match = key.match(PEM_RE);
  if (!match) {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY is not a PEM key (no -----BEGIN ... KEY----- block). ' +
        "Paste the full contents of the .pem file from the GitHub App's settings.",
    );
  }

  const [, label, body] = match;
  const lines = body.replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;

  try {
    createPrivateKey(pem);
  } catch (err) {
    throw new Error(
      `GITHUB_APP_PRIVATE_KEY could not be parsed (${(err as Error).message}). ` +
        'The key body is likely truncated or altered — re-paste the .pem file.',
    );
  }

  return pem;
}
