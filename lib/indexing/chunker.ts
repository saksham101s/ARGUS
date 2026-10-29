/**
 * Splits a file into retrieval chunks — pure, no I/O.
 *
 * Strategy: cut at top-level declarations (functions, classes, exports,
 * headings…) so a chunk is usually one coherent unit, then pack adjacent
 * small units together up to TARGET_LINES. Units longer than MAX_LINES fall
 * back to overlapping fixed windows.
 *
 * This is a language-agnostic heuristic, not a parser. It works because
 * almost every mainstream language starts top-level declarations at column
 * 0. A tree-sitter chunker can replace this later behind the same signature.
 */

export interface Chunk {
  /** 1-based, inclusive. */
  lineStart: number;
  lineEnd: number;
  content: string;
}

/**
 * Bump whenever chunking output changes. It's part of each file's stored
 * index key, so existing indexes re-chunk on their next run — without it,
 * incremental indexing (by blob sha) would never revisit unchanged files.
 */
export const CHUNKER_VERSION = 2;

export const TARGET_LINES = 60;
/** A pack this small (e.g. just imports) merges into the next unit. */
const MIN_PACK_LINES = 15;
export const MAX_LINES = 120;
const OVERLAP_LINES = 10;
/** Guards against huge single lines blowing the embedding token budget. */
const MAX_CHUNK_CHARS = 8_000;

/** Column-0 lines that start a new declaration in common languages. */
const DECLARATION_RE =
  /^(export\s|default\s|async\s|public\s|private\s|protected\s|internal\s|static\s|abstract\s|final\s|pub(\(\w+\))?\s|function[\s*]|class\s|interface\s|type\s|enum\s|const\s|let\s|var\s|def\s|fn\s|func\s|impl[\s<]|struct\s|trait\s|module\s|namespace\s|object\s|create\s|alter\s|@\w)/i;

const MARKDOWN_HEADING_RE = /^#{1,3}\s/;

/** Comment / decorator lines that belong to the declaration below them. */
// `\s*\*` covers JSDoc continuation lines (" * text", " */").
const LEADING_RE = /^(\/\/|\/\*|\s*\*|#|--|@\w|""")/;

function isBoundary(line: string, markdown: boolean): boolean {
  if (markdown) return MARKDOWN_HEADING_RE.test(line);
  return DECLARATION_RE.test(line);
}

/** Indices (0-based) where a new unit starts, including its leading comments. */
function findBoundaries(lines: string[], markdown: boolean): number[] {
  const starts = new Set<number>([0]);

  for (let i = 1; i < lines.length; i++) {
    if (!isBoundary(lines[i], markdown)) continue;

    // Pull preceding doc comments / decorators into this unit.
    let start = i;
    while (start > 0 && !markdown && LEADING_RE.test(lines[start - 1])) start--;
    starts.add(start);
  }

  return [...starts].sort((a, b) => a - b);
}

function toChunk(lines: string[], from: number, to: number): Chunk {
  // `to` is exclusive. Trim trailing blank lines so line ranges are tight.
  let end = to;
  while (end > from + 1 && lines[end - 1].trim() === '') end--;
  return {
    lineStart: from + 1,
    lineEnd: end,
    content: lines.slice(from, end).join('\n').slice(0, MAX_CHUNK_CHARS),
  };
}

function splitWindows(lines: string[], from: number, to: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = from; start < to; start += MAX_LINES - OVERLAP_LINES) {
    const end = Math.min(start + MAX_LINES, to);
    chunks.push(toChunk(lines, start, end));
    if (end === to) break;
  }
  return chunks;
}

export function chunkFile(path: string, content: string): Chunk[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (content.trim() === '') return [];

  const markdown = /\.mdx?$/i.test(path);
  const boundaries = [...findBoundaries(lines, markdown), lines.length];

  const chunks: Chunk[] = [];
  let packStart = 0;

  for (let b = 1; b < boundaries.length; b++) {
    const unitStart = boundaries[b - 1];
    const unitEnd = boundaries[b];

    if (unitEnd - unitStart > MAX_LINES) {
      // Flush whatever was packed before this oversized unit, then window it.
      if (unitStart > packStart) chunks.push(toChunk(lines, packStart, unitStart));
      chunks.push(...splitWindows(lines, unitStart, unitEnd));
      packStart = unitEnd;
      continue;
    }

    // Close the current pack if adding this unit would exceed the target —
    // unless the pack is too small to stand alone (an import block alone
    // is useless retrieval context) and merging still fits MAX_LINES.
    const packTooSmall =
      unitStart - packStart < MIN_PACK_LINES && unitEnd - packStart <= MAX_LINES;
    if (unitEnd - packStart > TARGET_LINES && unitStart > packStart && !packTooSmall) {
      chunks.push(toChunk(lines, packStart, unitStart));
      packStart = unitStart;
    }
  }

  if (packStart < lines.length) chunks.push(toChunk(lines, packStart, lines.length));

  return chunks.filter((c) => c.content.trim() !== '');
}

/**
 * The text actually embedded. The path header matters: it lets a query like
 * "auth middleware" match `lib/auth.ts` even when the code never says "auth".
 */
export function embeddingText(path: string, chunk: Chunk): string {
  return `File: ${path} (lines ${chunk.lineStart}-${chunk.lineEnd})\n\n${chunk.content}`;
}
