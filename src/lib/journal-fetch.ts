export function journalErrorDestination(status: number, code?: string): string | null {
  if (status === 409 && code === 'SESSION_CHANGED') return '/login';
  if (status === 401) return '/login';
  if (status === 403 && code === 'EMAIL_UNVERIFIED') return '/check-email';
  if (status === 403 && code === 'JOURNAL_ACCESS_REVOKED') return '/journal-access';
  return null;
}

/** Full navigation on lost access discards the old user's in-memory journal. */
export async function journalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const expectedUser = getJournalUser();
  if (expectedUser) headers.set('x-journal-user', expectedUser);
  const response = await fetch(input, { ...init, headers, cache: 'no-store' });
  if (response.ok) return response;
  const body = await response.clone().json().catch(() => null) as { code?: string; error?: string } | null;
  const destination = journalErrorDestination(response.status, body?.code);
  if (destination) {
    if (typeof window !== 'undefined') window.location.assign(destination);
    throw new Error(body?.error ?? 'Your journal session has ended. Please sign in again.');
  }
  if (response.status === 503) throw new Error(body?.error ?? 'Journal is temporarily unavailable. Please retry shortly.');
  return response;
}
import { getJournalUser } from './journal-session';
