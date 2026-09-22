/**
 * GitHub App Manifest
 *
 * This defines the configuration for the Argus GitHub App.
 * Use this as a reference when creating the app manually at
 * https://github.com/settings/apps/new, or via the manifest flow.
 *
 * Docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

export const GITHUB_APP_MANIFEST = {
  /** Display name in GitHub. Append a suffix (e.g. "-dev") if "Argus" is taken. */
  name: 'Argus',

  /** Public-facing URL shown on the GitHub App page */
  url: 'http://localhost:3000',

  /** Where GitHub sends webhook payloads */
  hook_attributes: {
    url: 'http://localhost:3000/api/webhooks/github',
    active: true,
  },

  /** Callback URL for the GitHub App's OAuth flow (not the separate OAuth App) */
  redirect_url: 'http://localhost:3000/api/auth/callback/github',

  /**
   * Webhook events the app subscribes to.
   * - pull_request: fires on PR open, sync, close, etc.
   * - installation: fires when the app is installed/uninstalled
   */
  default_events: ['pull_request', 'installation'],

  /**
   * Repository permissions.
   * - pull_requests: write  — to post review comments
   * - contents: read        — to read repo files for full-codebase context
   * - checks: write         — to create check runs on PRs
   * - metadata: read        — required baseline (always implicitly granted)
   */
  default_permissions: {
    pull_requests: 'write',
    contents: 'read',
    checks: 'write',
    metadata: 'read',
  },

  /** Keep private while in development */
  public: false,
} as const;

/**
 * Print the manifest as JSON for easy copy-paste when creating the app.
 * Run: npx tsx lib/github/manifest.ts
 */
if (require.main === module) {
  console.log(JSON.stringify(GITHUB_APP_MANIFEST, null, 2));
}
