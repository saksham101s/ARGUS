/**
 * Which repository files are worth indexing — pure, no I/O.
 *
 * The goal is "code a reviewer would want as context": source, config, SQL,
 * docs. Generated, vendored, binary and lock files only add noise to
 * retrieval and cost embedding tokens.
 */

/** Files above this size are almost always generated or data, not code. */
export const MAX_FILE_BYTES = 100_000;
/** JSON is mostly data (fixtures, lockfile-likes); keep only small config. */
const MAX_JSON_BYTES = 20_000;

const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.git',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.turbo',
  '.cache',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'next-env.d.ts',
]);

const SKIP_SUFFIXES = ['.min.js', '.min.css', '.map', '.snap', '.d.ts.map'];

/** Extension → language label (stored on chunks; used for filtering later). */
const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  scala: 'scala',
  dart: 'dart',
  lua: 'lua',
  sh: 'shell',
  bash: 'shell',
  sql: 'sql',
  graphql: 'graphql',
  prisma: 'prisma',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  json: 'json',
  ipynb: 'skip', // notebooks are huge JSON blobs
};

export function detectLanguage(path: string): string | null {
  const name = path.split('/').pop() ?? path;
  if (name === 'Dockerfile') return 'dockerfile';
  if (name === 'Makefile') return 'make';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const lang = LANGUAGES[ext];
  return lang && lang !== 'skip' ? lang : null;
}

export function shouldIndexFile(path: string, sizeBytes: number): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1];

  if (parts.slice(0, -1).some((dir) => SKIP_DIRS.has(dir))) return false;
  if (SKIP_FILES.has(name)) return false;
  if (SKIP_SUFFIXES.some((s) => name.endsWith(s))) return false;
  if (sizeBytes > MAX_FILE_BYTES) return false;

  const lang = detectLanguage(path);
  if (!lang) return false;
  if (lang === 'json' && sizeBytes > MAX_JSON_BYTES) return false;

  return true;
}

/**
 * Content-level check after download: rejects binary files mislabeled by
 * extension and minified/generated code (very long average line length).
 */
export function isIndexableContent(content: string): boolean {
  if (content.includes('\0')) return false;
  const lines = content.split('\n');
  return content.length / Math.max(lines.length, 1) <= 300;
}
