import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AccessDenial = {
  ok: false;
  status: 401 | 403 | 503;
  code: 'UNAUTHORIZED' | 'EMAIL_UNVERIFIED' | 'JOURNAL_ACCESS_REVOKED' | 'ACCESS_CHECK_UNAVAILABLE' | 'ACCOUNT_DELETING';
  error: string;
};
export type AccessResult = { ok: true; userId: string } | AccessDenial;

export const unauthorized = (): AccessDenial => ({
  ok: false, status: 401, code: 'UNAUTHORIZED', error: 'Please sign in to your journal.',
});
export const accessUnavailable = (): AccessDenial => ({
  ok: false, status: 503, code: 'ACCESS_CHECK_UNAVAILABLE',
  error: 'Journal access could not be checked. Please retry shortly or contact the site owner.',
});

/** Identity must come from Auth verification, never request data or getSession(). */
export async function checkJournalAccess(sb: SupabaseClient, user: User | null): Promise<AccessResult> {
  const bannedUntil = (user as (User & { banned_until?: string }) | null)?.banned_until;
  if (!user || (bannedUntil && Date.parse(bannedUntil) > Date.now())) return unauthorized();
  if (!user.email_confirmed_at) {
    return { ok: false, status: 403, code: 'EMAIL_UNVERIFIED', error: 'Verify your email before using the journal.' };
  }
  try {
    const { data, error } = await sb.from('journal_access').select('status,deletion_requested_at').eq('user_id', user.id).maybeSingle();
    if (error || !data) return accessUnavailable();
    if (data.deletion_requested_at) {
      return { ok: false, status: 403, code: 'ACCOUNT_DELETING', error: 'Account deletion has started. Open Account settings to finish deletion.' };
    }
    if (data.status === 'revoked') {
      return { ok: false, status: 403, code: 'JOURNAL_ACCESS_REVOKED', error: 'Journal access is unavailable for this account. Contact the site owner.' };
    }
    if (data.status !== 'active') return accessUnavailable();
    return { ok: true, userId: user.id };
  } catch {
    return accessUnavailable();
  }
}
