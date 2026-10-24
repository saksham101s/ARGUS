/**
 * Voyage AI embeddings via the REST API.
 *
 * Plain fetch instead of the `voyageai` SDK: one endpoint, and we need
 * control over batching and 429 backoff (Voyage's free tier is limited to a
 * few requests per minute until a payment method is added).
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

async function embedBatch(input: string[], inputType: InputType): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not set. See .env.example.');

  for (let attempt = 1; ; attempt++) {
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
      const json = (await res.json()) as {
        data: { index: number; embedding: number[] }[];
      };
      return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Voyage embeddings failed (${res.status}): ${await res.text()}`);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const delayMs =
      retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 30_000);
    console.warn(
      `[embeddings] ${res.status} — retrying in ${delayMs}ms (attempt ${attempt})`,
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
