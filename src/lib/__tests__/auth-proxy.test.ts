import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateSession } from '../supabase/proxy';

const h = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: h.create }));

describe('SSR proxy refresh', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-public';
    vi.clearAllMocks();
  });
  it('forwards rotated cookies to the request and response and prevents caching', async () => {
    h.create.mockImplementation((_url, _key, opts) => ({ auth: { getClaims: async () => {
      opts.cookies.setAll([{ name: 'sb-test-auth-token', value: 'rotated', options: { path: '/', sameSite: 'lax' } }], { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
      return { data: null, error: null };
    } } }));
    const request = new NextRequest('http://localhost/journal');
    const response = await updateSession(request);
    expect(request.cookies.get('sb-test-auth-token')?.value).toBe('rotated');
    expect(response.cookies.get('sb-test-auth-token')?.value).toBe('rotated');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('never adds browser-cookie authentication to MT5 ingest', async () => {
    await updateSession(new NextRequest('http://localhost/api/journal/ingest'));
    expect(h.create).not.toHaveBeenCalled();
  });
});
