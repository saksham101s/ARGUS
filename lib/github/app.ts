import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

/**
 * GitHub App authentication — JWT to installation token flow.
 *
 * The App authenticates as itself using a JWT (signed with the private key),
 * then exchanges that for an installation-scoped token to interact with
 * specific repositories.
 */

function getAppConfig() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error(
      'Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY environment variables. ' +
        'See .env.example for the required variables.',
    );
  }

  return { appId, privateKey };
}

/**
 * Creates an Octokit client authenticated as a specific GitHub App installation.
 *
 * The flow:
 * 1. Sign a JWT using the App's private key
 * 2. Exchange the JWT for an installation access token
 * 3. Return an Octokit instance scoped to that installation
 *
 * @param installationId - The numeric ID of the GitHub App installation
 */
export async function getInstallationClient(
  installationId: number,
): Promise<Octokit> {
  const { appId, privateKey } = getAppConfig();

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });

  return octokit;
}

/**
 * Creates an Octokit client authenticated as the GitHub App itself (JWT auth).
 * Useful for app-level operations like listing installations.
 */
export function getAppClient(): Octokit {
  const { appId, privateKey } = getAppConfig();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });
}
