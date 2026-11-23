import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** One deadline covers the entire Storage operation, including SDK retries. */
export function screenshotBucket() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Screenshot storage is not configured');
  const deadline = AbortSignal.timeout(30_000);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
      }),
    },
  }).storage.from('journal-screenshots');
}
