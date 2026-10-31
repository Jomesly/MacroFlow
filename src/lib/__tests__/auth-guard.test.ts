import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireJournalAccess } from '../auth';

const h = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../auth-navigation', () => ({ getJournalAccess: h.access }));

describe('journal API guard', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3137'; vi.clearAllMocks(); });
  it('rejects a foreign-origin cookie mutation even for an allowed user', async () => {
    h.access.mockResolvedValue({ ok: true, userId: 'a' });
    const result = await requireJournalAccess(new NextRequest('http://localhost:3137/api/journal/keys', { method: 'POST', headers: { origin: 'https://foreign.test' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
  it('does not trust a legacy access-token cookie', async () => {
    h.access.mockResolvedValue({ ok: false, status: 401, code: 'UNAUTHORIZED', error: 'Sign in' });
    const result = await requireJournalAccess(new NextRequest('http://localhost:3137/api/journal/trade', { headers: { cookie: 'sb-access-token=forged' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
      expect(result.response.headers.has('location')).toBe(false);
    }
  });
  it('rejects a retained draft when cookies now belong to another account', async () => {
    h.access.mockResolvedValue({ ok: true, userId: 'b' });
    const result = await requireJournalAccess(new NextRequest('http://localhost:3137/api/journal/trade', {
      method: 'POST', headers: { 'x-journal-user': 'a' },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(409);
      expect(await result.response.json()).toMatchObject({ code: 'SESSION_CHANGED' });
    }
  });
  it('returns a retryable JSON denial for provisioning failures', async () => {
    h.access.mockResolvedValue({ ok: false, status: 503, code: 'ACCESS_CHECK_UNAVAILABLE', error: 'Retry' });
    const result = await requireJournalAccess(new NextRequest('http://localhost:3137/api/journal/trade'));
    if (result.ok) throw new Error('unexpected access');
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get('retry-after')).toBe('30');
  });
});
