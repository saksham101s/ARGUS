import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import ws from 'ws';

type RealtimeTransport = NonNullable<
  SupabaseClientOptions<'public'>['realtime']
>['transport'];

let client: SupabaseClient | undefined;

/**
 * Server-side Supabase client (memoized per server instance).
 *
 * Uses the service role key for unrestricted access — never expose
 * SUPABASE_SERVICE_ROLE_KEY to the browser. RLS is enabled on every table
 * with no policies (migration 003), so the service role is the only way in.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'See .env.example for the required variables.',
    );
  }

  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // supabase-js throws at construction on Node < 22 (no native WebSocket),
    // even though Argus never uses realtime. `ws` satisfies that check; its
    // typings are stricter than supabase's WebSocketLike, hence the cast.
    realtime: { transport: ws as unknown as RealtimeTransport },
  });

  return client;
}
