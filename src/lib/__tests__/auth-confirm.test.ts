import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/auth/confirm/route';

const h = vi.hoisted(() => ({ verify: vi.fn(), exchange: vi.fn() }));
vi.mock('../supabase/server', () => ({ createServerAuthClient: async () => ({ auth: { verifyOtp: h.verify, exchangeCodeForSession: h.exchange } }) }));

describe('email confirmation callback', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3137';
    h.verify.mockReset().mockResolvedValue({ error: null });
    h.exchange.mockReset().mockResolvedValue({ data: { redirectType: null }, error: null });
  });
  it('does not call Auth for unsupported types', async () => {
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?token_hash=test&type=invite'));
    expect(response.headers.get('location')).toBe('http://localhost:3137/check-email?error=invalid-link');
    expect(h.verify).not.toHaveBeenCalled();
  });
  it('ignores hostile next URLs and does not reflect the token into redirects', async () => {
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?token_hash=test&type=email&next=https://evil.test'));
    expect(response.headers.get('location')).toBe('http://localhost:3137/journal/welcome');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('directs recovery to reset and replay failures to a fresh link', async () => {
    expect((await GET(new NextRequest('http://localhost:3137/auth/confirm?token_hash=test&type=recovery'))).headers.get('location')).toBe('http://localhost:3137/reset-password');
    h.verify.mockResolvedValue({ error: { status: 403 } });
    expect((await GET(new NextRequest('http://localhost:3137/auth/confirm?token_hash=used&type=recovery'))).headers.get('location')).toBe('http://localhost:3137/forgot-password?error=invalid-link');
  });
  it.each([500, 503, 0])('keeps valid links retryable when Auth returns status %s', async (status) => {
    h.verify.mockResolvedValue({ error: { status } });
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?token_hash=test&type=email'));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.has('location')).toBe(false);
  });
  it('preserves throttling as a retryable response', async () => {
    h.verify.mockResolvedValue({ error: { status: 429 } });
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?token_hash=test&type=recovery'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.text()).toContain('retry');
  });
  it('exchanges standard Supabase confirmation codes instead of reporting an invalid link', async () => {
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?code=valid-test-code&next=https://evil.test'));
    expect(response.headers.get('location')).toBe('http://localhost:3137/journal/welcome');
    expect(h.exchange).toHaveBeenCalledWith('valid-test-code');
    expect(h.verify).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('uses the SDK recovery flow marker, not an arbitrary next URL', async () => {
    h.exchange.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null });
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?code=recovery-test-code'));
    expect(response.headers.get('location')).toBe('http://localhost:3137/reset-password');
  });
  it('explains a missing same-browser PKCE verifier without granting a session', async () => {
    h.exchange.mockResolvedValue({ data: null, error: { name: 'AuthPKCECodeVerifierMissingError', status: 400 } });
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?code=test-code'));
    expect(response.headers.get('location')).toBe('http://localhost:3137/check-email?error=browser-mismatch');
  });
  it.each([429, 503])('keeps code-exchange failures retryable for status %s', async (status) => {
    h.exchange.mockResolvedValue({ data: null, error: { status } });
    const response = await GET(new NextRequest('http://localhost:3137/auth/confirm?code=test-code'));
    expect(response.status).toBe(status);
    expect(response.headers.has('location')).toBe(false);
  });
  it('rejects expired codes and missing or conflicting callback inputs', async () => {
    h.exchange.mockResolvedValue({ data: null, error: { status: 400, code: 'flow_state_expired' } });
    expect((await GET(new NextRequest('http://localhost:3137/auth/confirm?code=expired'))).headers.get('location')).toContain('error=invalid-link');
    h.exchange.mockClear();
    h.verify.mockClear();
    expect((await GET(new NextRequest('http://localhost:3137/auth/confirm'))).headers.get('location')).toContain('error=invalid-link');
    expect((await GET(new NextRequest('http://localhost:3137/auth/confirm?code=test&token_hash=test&type=email'))).headers.get('location')).toContain('error=invalid-link');
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
  });
});
