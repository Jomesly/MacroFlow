import { afterEach, describe, expect, it, vi } from 'vitest';
import { journalFetch, journalErrorDestination } from '../journal-fetch';
import { setJournalUser } from '../journal-session';

afterEach(() => { vi.unstubAllGlobals(); setJournalUser(null); });

describe('journal API failure navigation', () => {
  it('maps only recognized auth denials to public navigation', () => {
    expect(journalErrorDestination(401)).toBe('/login');
    expect(journalErrorDestination(403, 'EMAIL_UNVERIFIED')).toBe('/check-email');
    expect(journalErrorDestination(403, 'JOURNAL_ACCESS_REVOKED')).toBe('/journal-access');
    expect(journalErrorDestination(503, 'ACCESS_CHECK_UNAVAILABLE')).toBeNull();
    expect(journalErrorDestination(403, 'https://evil.test')).toBeNull();
    expect(journalErrorDestination(409, 'SESSION_CHANGED')).toBe('/login');
  });
  it('surfaces a retryable storage error without treating it as no trades', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Journal storage unavailable' }), { status: 503 })));
    await expect(journalFetch('/api/journal/trade')).rejects.toThrow('Journal storage unavailable');
  });
  it('leaves application validation errors available to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid trade' }), { status: 400 })));
    expect((await journalFetch('/api/journal/trade')).status).toBe(400);
  });
  it('binds a mounted journal request to its original owner, preserving caller headers', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    setJournalUser('original-owner');
    await journalFetch('/api/journal/trade', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(options[1].headers);
    expect(headers.get('x-journal-user')).toBe('original-owner');
    expect(headers.get('content-type')).toBe('application/json');
  });
});
