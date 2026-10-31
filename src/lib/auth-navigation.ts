import 'server-only';
import { redirect } from 'next/navigation';
import { getIdentity } from './auth-session';
import { checkJournalAccess, type AccessDenial } from './journal-access';
import { supabase } from './supabase';

export function accessDestination(denial: AccessDenial): string {
  if (denial.code === 'UNAUTHORIZED') return '/login';
  if (denial.code === 'EMAIL_UNVERIFIED') return '/check-email';
  return '/journal-access';
}

export async function getJournalAccess() {
  const identity = await getIdentity();
  if (!identity.ok) return identity;
  return checkJournalAccess(supabase, identity.user);
}

export async function requireJournalPageAccess(): Promise<{ userId: string }> {
  const access = await getJournalAccess();
  if (!access.ok) redirect(accessDestination(access));
  return { userId: access.userId };
}
