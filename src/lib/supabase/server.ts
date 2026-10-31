import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicSupabaseConfig } from './config';

/** A fresh auth client for every request. Service-role data access is separate. */
export async function createServerAuthClient() {
  const cookieStore = await cookies();
  const { url, key } = publicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Proxy persists refreshes first.
        }
      },
    },
  });
}
