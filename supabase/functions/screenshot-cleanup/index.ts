import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { screenshotCleanupHandler } from '../_shared/screenshot-cleanup.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const secret = Deno.env.get('SCREENSHOT_CLEANUP_SECRET') ?? '';
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const client = createClient(url, key, {
  auth,
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
});

Deno.serve((request: Request) => screenshotCleanupHandler(request, {
  client,
  secret,
  bucket: () => {
    const deadline = AbortSignal.timeout(20_000);
    return createClient(url, key, {
      auth,
      global: { fetch: (input, init) => fetch(input, { ...init, signal: deadline }) },
    }).storage.from('journal-screenshots');
  },
}));
