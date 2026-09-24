import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Uses a separate GitHub OAuth App (not the GitHub App) for dashboard login.
 * The OAuth App's Client ID and Secret come from:
 *   GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET
 *
 * Callback URL configured in the OAuth App:
 *   http://localhost:3000/api/auth/callback/github
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
  trustHost: true,
  callbacks: {
    async session({ session, token }) {
      // Pass GitHub user ID into the session for future use
      if (token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
