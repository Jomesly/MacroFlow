import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createServerAuthClient } from '@/lib/supabase/server';
import { publicSupabaseConfig } from '@/lib/supabase/config';
import { supabase } from '@/lib/supabase';
import { userDeletionSchema } from '@/lib/account-management';
import { accountFailure, accountResponse, checkAccountOrigin, requireAccountOwner } from '@/lib/account-api';

export async function GET(request: NextRequest) {
  const identity = await requireAccountOwner(request);
  if (!identity.ok) return identity.response;
  const { data, error } = await supabase.from('journal_access').select('deletion_requested_at')
    .eq('user_id', identity.user.id).maybeSingle();
  if (error) return accountFailure(error);
  return accountResponse({ userId: identity.user.id, email: identity.user.email, deletionPending: !!data?.deletion_requested_at });
}

export async function DELETE(request: NextRequest) {
  const originError = checkAccountOrigin(request);
  if (originError) return originError;
  const identity = await requireAccountOwner(request);
  if (!identity.ok) return identity.response;
  const parsed = userDeletionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return accountResponse({ error: parsed.error.issues[0].message }, 400);
  if (!identity.user.email) return accountResponse({ error: 'Password verification is unavailable for this account.' }, 400);

  // Verify the password on an isolated client. Never replace this browser's
  // cookies or trust a user ID/email supplied in the request body.
  const { url, key } = publicSupabaseConfig();
  const verifier = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let verified;
  try {
    verified = await verifier.auth.signInWithPassword({ email: identity.user.email, password: parsed.data.password });
  } catch {
    return accountResponse({ error: 'Password verification is temporarily unavailable. Please retry.' }, 503);
  }
  if (verified.error) {
    const status = verified.error.status === 429 ? 429 : (verified.error.status ?? 500) >= 500 ? 503 : 400;
    return accountResponse({ error: status === 429 ? 'Too many attempts. Wait before retrying.' : status === 503 ? 'Password verification is temporarily unavailable.' : 'Your current password is incorrect.' }, status);
  }
  if (verified.data.user?.id !== identity.user.id) {
    await verifier.auth.signOut({ scope: 'local' });
    return accountResponse({ error: 'Your account changed. Reload before continuing.', code: 'SESSION_CHANGED' }, 409);
  }
  await verifier.auth.signOut({ scope: 'local' });

  const { error: prepareError } = await supabase.rpc('prepare_journal_user_deletion', { p_user_id: identity.user.id });
  if (prepareError) return accountFailure(prepareError);
  const { error: deleteError } = await supabase.auth.admin.deleteUser(identity.user.id);
  if (deleteError && deleteError.status !== 404) {
    return accountResponse({
      error: 'Deletion could not finish. Your journal and API keys are blocked. Retry here to finish deleting your account.',
      code: 'DELETION_PENDING', deletionPending: true,
    }, 503);
  }
  try {
    const auth = await createServerAuthClient();
    await auth.auth.signOut({ scope: 'local' });
  } catch { /* The identity is already gone; expire browser cookies below. */ }
  const response = accountResponse({ ok: true });
  const project = new URL(url).hostname.split('.')[0];
  const prefix = 'sb-' + project + '-auth-token';
  request.cookies.getAll().filter(({ name }) => name === prefix || name.startsWith(prefix + '.') || name === prefix + '-code-verifier' || name === 'sb-access-token')
    .forEach(({ name }) => response.cookies.set(name, '', { maxAge: 0, path: '/' }));
  return response;
}
