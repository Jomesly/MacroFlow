import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const h = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock('../auth', () => ({ requireJournalAccess: h.auth }));
vi.mock('../journal', () => ({ listTrades: h.list }));
import { GET } from '../../app/api/journal/review/route';
beforeEach(() => { vi.clearAllMocks(); h.auth.mockResolvedValue({ ok: true, userId: 'owner' }); h.list.mockResolvedValue([]); });
it('does not load journal records without access', async () => {
  h.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Sign in' }, { status: 401 }) });
  expect((await GET(new NextRequest('http://localhost:3000/api/journal/review'))).status).toBe(401);
  expect(h.list).not.toHaveBeenCalled();
});
it('rejects invalid dates and account filters before database reads', async () => {
  for (const query of ['week=2026-02-30', 'account=-1', 'account=0', 'account=one', 'account=9007199254740992']) {
    expect((await GET(new NextRequest(`http://localhost:3000/api/journal/review?${query}`))).status).toBe(400);
  }
  expect(h.list).not.toHaveBeenCalled();
});
it('uses the authenticated owner and returns an uncached report', async () => {
  const res = await GET(new NextRequest('http://localhost:3000/api/journal/review?week=2026-11-08&account=1'));
  expect(h.list).toHaveBeenCalledWith('owner', undefined);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect((await res.json()).review.start).toBe('2026-11-02');
});
