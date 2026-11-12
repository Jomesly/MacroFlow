import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/journal/ingest/route';

const h = vi.hoisted(() => ({ key: vi.fn(), identity: vi.fn(), access: vi.fn(), write: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: h.write, auth: { admin: { getUserById: h.identity } } } }));
vi.mock('../journal-access', async (original) => ({ ...await original<object>(), checkJournalAccess: h.access }));
vi.mock('../ingest-store', () => ({
  authenticateApiKey: h.key, checkIngestRateLimit: vi.fn(() => true),
}));

describe('MT5 owner access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.key.mockResolvedValue({ userId: 'owner-a', keyId: 1 });
    h.identity.mockResolvedValue({ data: { user: { id: 'owner-a' } }, error: null });
    h.access.mockResolvedValue({ ok: false, status: 403, code: 'JOURNAL_ACCESS_REVOKED', error: 'Access revoked' });
  });
  const request = () => new NextRequest('http://localhost/api/journal/ingest', {
    method: 'POST', headers: { authorization: 'Bearer mf_test' }, body: '{}',
  });
  it('denies a valid key whose owner no longer has access before processing payloads', async () => {
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(h.write).not.toHaveBeenCalled();
  });
  it('makes Auth dependency failures retryable instead of accepting a key alone', async () => {
    h.identity.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    expect((await POST(request())).status).toBe(503);
    expect(h.write).not.toHaveBeenCalled();
  });
  it('denies deleted owners even when the key lookup succeeded', async () => {
    h.identity.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
    expect((await POST(request())).status).toBe(403);
    expect(h.write).not.toHaveBeenCalled();
  });
  it('returns a retryable error when the API key store is unavailable', async () => {
    h.key.mockRejectedValue(new Error('Key storage unavailable'));
    expect((await POST(request())).status).toBe(503);
    expect(h.write).not.toHaveBeenCalled();
  });
});
