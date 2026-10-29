/**
 * Voyage AI embeddings via the REST API.
 *
 * Plain fetch instead of the `voyageai` SDK: one endpoint, and we need
 * control over batching and 429 handling. Without a payment method Voyage
 * limits an account to 3 requests / 10K tokens per minute, so a rate-limited
 * batch is split (see `tokenCap`) instead of just retried.
 */

export const EMBEDDING_MODEL = 'voyage-code-3';
/** Must match `code_chunks.embedding vector(1024)`. */
export const EMBEDDING_DIMENSIONS = 1024;

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
/** Voyage caps voyage-code-3 at 1000 inputs / 120K tokens per request. */
const MAX_BATCH_INPUTS = 128;
const MAX_BATCH_TOKENS = 100_000;
const MAX_ATTEMPTS = 6;

/** Conservative estimate — code tokenizes denser than prose. */
const estimateTokens = (text: string) => Math.ceil(text.length / 3);

/**
 * `document` for indexed chunks, `query` for retrieval. Voyage prepends a
 * different instruction for each, which measurably improves retrieval.
 */
export type InputType = 'document' | 'query';

export async function embed(texts: string[], inputType: InputType): Promise<number[][]> {
  const results: number[][] = [];
  for (const batch of toBatches(texts)) {
    results.push(...(await embedBatch(batch, inputType)));
  }
  return results;
}

function toBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let tokens = 0;

  for (const text of texts) {
    const t = estimateTokens(text);
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_INPUTS || tokens + t > MAX_BATCH_TOKENS)
    ) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += t;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Learned per-request token ceiling. Starts at Voyage's documented limit and
 * shrinks when a batch is rate-limited: a batch larger than the account's
 * tokens-per-minute limit (10K on the free tier) can never succeed, no
 * matter how long we wait, so it must be split.
 *
 * The floor matters as much as the splitting: the free tier also allows
 * only 3 requests/minute, so smaller batches mean *more* one-minute waits.
 * At or below the floor a 429 is treated as "window exhausted" — wait, then
 * resend the same batch. 8K estimated tokens fits the 10K TPM limit.
 */
let tokenCap = MAX_BATCH_TOKENS;
const MIN_TOKEN_CAP = 8_000;
/** Voyage's limits are per minute; waiting a full window guarantees reset. */
const RATE_LIMIT_WAIT_MS = 65_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(
  input: string[],
  inputType: InputType,
  attempt = 1,
): Promise<number[][]> {
  const tokens = input.reduce((sum, t) => sum + estimateTokens(t), 0);
  if (input.length > 1 && tokens > tokenCap) return embedHalves(input, inputType);

  const res = await request(input, inputType);
  if ('vectors' in res) return res.vectors;

  const retryable = res.status === 429 || res.status >= 500;
  if (!retryable || attempt >= MAX_ATTEMPTS) {
    throw new Error(`Voyage embeddings failed (${res.status}): ${res.body}`);
  }

  const delayMs =
    res.retryAfterMs ??
    (res.status === 429 ? RATE_LIMIT_WAIT_MS : Math.min(2 ** attempt * 1000, 30_000));
  console.warn(
    `[embeddings] ${res.status} on ${input.length} input(s) (~${tokens} tokens) — ` +
      `waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})`,
  );
  await sleep(delayMs);

  if (res.status === 429 && input.length > 1 && tokens > MIN_TOKEN_CAP) {
    // Possibly too big for the per-minute token limit: remember a smaller
    // cap so later batches are sized right up front, then split this one.
    tokenCap = Math.max(MIN_TOKEN_CAP, Math.floor(tokens / 2));
    return embedHalves(input, inputType);
  }
  return embedBatch(input, inputType, attempt + 1);
}

async function embedHalves(input: string[], inputType: InputType): Promise<number[][]> {
  const mid = Math.ceil(input.length / 2);
  const first = await embedBatch(input.slice(0, mid), inputType);
  const second = await embedBatch(input.slice(mid), inputType);
  return [...first, ...second];
}

type VoyageResponse =
  { vectors: number[][] } | { status: number; body: string; retryAfterMs: number | null };

async function request(input: string[], inputType: InputType): Promise<VoyageResponse> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not set. See .env.example.');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      model: EMBEDDING_MODEL,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSIONS,
      truncation: true,
    }),
  });

  if (res.ok) {
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return {
      vectors: json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding),
    };
  }

  const retryAfter = Number(res.headers.get('retry-after'));
  return {
    status: res.status,
    body: await res.text(),
    retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : null,
  };
}
