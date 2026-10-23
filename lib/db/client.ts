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

  // A public key here fails silently on reads (RLS returns no rows) and
  // with a confusing RLS error on writes — reject it up front instead.
  if (isPublicKey(key)) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is a public (publishable/anon) key. Use the ' +
        'secret key: Supabase → Project Settings → API Keys → sb_secret_…',
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

/** True for new-style publishable keys and legacy JWT keys with role "anon". */
function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  if (!key.startsWith('eyJ')) return false;
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return claims.role === 'anon';
  } catch {
    return false;
  }
}
