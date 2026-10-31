import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createServerAuthClient } from './supabase/server';
import { accessUnavailable, unauthorized, type AccessDenial } from './journal-access';

export type IdentityResult = { ok: true; user: User } | AccessDenial;

export function identityError(error: { status?: number; name?: string } | null): AccessDenial {
  if (error?.name === 'AuthSessionMissingError' ||
      (error?.status && error.status >= 400 && error.status < 500 && error.status !== 429)) {
    return unauthorized();
  }
  return accessUnavailable();
}

export async function getIdentity(client?: SupabaseClient): Promise<IdentityResult> {
  try {
    const auth = client ?? await createServerAuthClient();
    const { data, error } = await auth.auth.getUser();
    if (error) return identityError(error);
    if (!data.user) return unauthorized();
    return { ok: true, user: data.user };
  } catch {
    return accessUnavailable();
  }
}
