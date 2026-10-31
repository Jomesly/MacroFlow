import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getJournalAccess } from './auth-navigation';
import { applicationOrigin } from './auth-validation';

export type JournalAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/** Per-request identity, verified email and server-controlled journal permission. */
export async function requireJournalAccess(request: NextRequest): Promise<JournalAuthResult> {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.has('origin')) {
    try {
      if (request.headers.get('origin') !== applicationOrigin()) {
        return { ok: false, response: NextResponse.json({ error: 'This request origin is not allowed.', code: 'INVALID_ORIGIN' }, { status: 403 }) };
      }
    } catch {
      return { ok: false, response: NextResponse.json({ error: 'Journal configuration is unavailable.', code: 'ACCESS_CHECK_UNAVAILABLE' }, { status: 503 }) };
    }
  }
  const access = await getJournalAccess();
  if (access.ok) {
    const expectedUser = request.headers.get('x-journal-user');
    if (expectedUser && expectedUser !== access.userId) {
      return { ok: false, response: NextResponse.json({
        code: 'SESSION_CHANGED', error: 'Your account changed. Reopen your journal before continuing.',
      }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } }) };
    }
    return access;
  }
  return {
    ok: false,
    response: NextResponse.json({ error: access.error, code: access.code }, {
      status: access.status,
      headers: { 'Cache-Control': 'private, no-store', ...(access.status === 503 ? { 'Retry-After': '30' } : {}) },
    }),
  };
}
