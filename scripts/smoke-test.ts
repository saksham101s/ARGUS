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

import 'dotenv/config';

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
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'NEXTAUTH_SECRET',
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

  if (missing.length > 0) {
    console.log(`\n  ⚠ ${missing.length} variable(s) missing.`);
    return false;
  }

  console.log('\n  ✓ All environment variables present.');
  return true;
}

async function checkSupabase(): Promise<boolean> {
  console.log('\n─── Check 2: Supabase Connection ───');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log('  ✗ Supabase credentials not configured — skipping.');
    return false;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Simple query to verify connection — list tables from the schema
    const { data, error } = await supabase
      .from('installations')
      .select('id')
      .limit(1);

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = "no rows" which is fine for an empty table
      throw error;
    }

    console.log('  ✓ Supabase connection successful.');
    return true;
  } catch (err) {
    console.log(`  ✗ Supabase connection failed: ${(err as Error).message}`);
    return false;
  }
}

async function checkGitHubApp(): Promise<boolean> {
  console.log('\n─── Check 3: GitHub App Authentication ───');

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.log('  ✗ GitHub App credentials not configured — skipping.');
    return false;
  }

  try {
    const { Octokit } = await import('@octokit/rest');
    const { createAppAuth } = await import('@octokit/auth-app');

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey },
    });

    // Authenticate as the app and list installations
    const { data: installations } =
      await octokit.apps.listInstallations();
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
    console.log(
      `  ✗ GitHub App authentication failed: ${(err as Error).message}`,
    );
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║       Argus — Smoke Test             ║');
  console.log('╚══════════════════════════════════════╝');

  const results = await Promise.all([
    checkEnvVars(),
    checkSupabase(),
    checkGitHubApp(),
  ]);

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
