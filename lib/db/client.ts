import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client.
 *
 * Uses the service role key for unrestricted access — never expose
 * SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'See .env.example for the required variables.',
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
