import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { applicationOrigin } from './auth-validation';
import { getIdentity } from './auth-session';
import { accountError } from './account-management';

export function accountResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store',
    ...(process.env.MACROFLOW_ACCOUNT_EVAL === 'true' ? { 'X-MacroFlow-Local-Evaluation': 'true' } : {}),
  } });
}

export function accountFailure(error: { message?: string; code?: string }) {
  const failure = accountError(error);
  return accountResponse({ error: failure.error, code: failure.code }, failure.status);
}

export function checkAccountOrigin(request: NextRequest) {
  try {
    if (request.headers.get('origin') === applicationOrigin()) return null;
    return accountResponse({ error: 'This request origin is not allowed.', code: 'INVALID_ORIGIN' }, 403);
  } catch {
    return accountResponse({ error: 'Application configuration is unavailable.' }, 503);
  }
}

/** Account settings remain reachable without an active journal grant. */
export async function requireAccountOwner(request: NextRequest) {
  const identity = await getIdentity();
  if (!identity.ok) return { ok: false as const, response: accountResponse({ error: identity.error, code: identity.code }, identity.status) };
  const expectedUser = request.headers.get('x-journal-user');
  if (expectedUser && expectedUser !== identity.user.id) {
    return { ok: false as const, response: accountResponse({ error: 'Your account changed. Reload before continuing.', code: 'SESSION_CHANGED' }, 409) };
  }
  return identity;
}
