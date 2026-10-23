/**
 * Smoke Test — verifies foundational setup for Argus.
 *
 * Checks:
 * 1. All required environment variables are present
 * 2. Supabase connection works
 * 3. GitHub App can authenticate and list installations
 *
 * Run: npm run smoke-test
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env.local (Next.js convention for local secrets)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const REQUIRED_ENV_VARS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXTAUTH_SECRET',
] as const;

// These are wired but not needed until later phases
const OPTIONAL_ENV_VARS = [
  'ANTHROPIC_API_KEY', // Phase 4
  'VOYAGE_API_KEY', // Phase 3
] as const;

async function checkEnvVars(): Promise<boolean> {
  console.log('\n─── Check 1: Environment Variables ───');
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
      console.log(`  ✗ ${key} — missing`);
    } else {
      console.log(`  ✓ ${key}`);
    }
  }

  for (const key of OPTIONAL_ENV_VARS) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      console.log(`  ○ ${key} — not set (optional, needed later)`);
    } else {
      console.log(`  ✓ ${key}`);
    }
  }

  if (missing.length > 0) {
    console.log(`\n  ⚠ ${missing.length} required variable(s) missing.`);
    return false;
  }

  console.log('\n  ✓ All required environment variables present.');
  return true;
}

// The checks below import the app's own clients (dynamically, so dotenv
// has populated process.env first) — a passing smoke test means the code
// paths the webhook uses actually work, not a parallel copy of them.

async function checkSupabase(): Promise<boolean> {
  console.log('\n─── Check 2: Supabase Connection ───');

  try {
    const { getSupabaseClient } = await import('../lib/db/client');
    const { error } = await getSupabaseClient()
      .from('installations')
      .select('id')
      .limit(1);

    if (error) throw error;

    console.log('  ✓ Supabase connection successful.');
    return true;
  } catch (err) {
    console.log(`  ✗ Supabase connection failed: ${(err as Error).message}`);
    return false;
  }
}

async function checkGitHubApp(): Promise<boolean> {
  console.log('\n─── Check 3: GitHub App Authentication ───');

  try {
    const { getAppClient } = await import('../lib/github/app');
    const { data: installations } = await getAppClient().apps.listInstallations();
    console.log(
      `  ✓ GitHub App authenticated. ${installations.length} installation(s) found.`,
    );

    for (const inst of installations) {
      console.log(
        `    • ${inst.account?.login} (ID: ${inst.id}, type: ${inst.account?.type})`,
      );
    }

    return true;
  } catch (err) {
    console.log(`  ✗ GitHub App authentication failed: ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║       Argus — Smoke Test             ║');
  console.log('╚══════════════════════════════════════╝');

  // Sequential so each check's output stays grouped under its heading.
  const results = [await checkEnvVars(), await checkSupabase(), await checkGitHubApp()];

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log('\n═══════════════════════════════════════');
  console.log(`  Result: ${passed}/${total} checks passed.`);
  console.log('═══════════════════════════════════════\n');

  if (passed < total) {
    process.exit(1);
  }
}

main();
