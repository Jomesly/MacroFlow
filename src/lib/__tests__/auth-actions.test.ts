import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signup, login, forgotPassword, resetPassword, resendConfirmation } from '../../app/auth/actions';

const h = vi.hoisted(() => ({ signup: vi.fn(), login: vi.fn(), signOut: vi.fn(), recovery: vi.fn(), update: vi.fn(), identity: vi.fn(), resend: vi.fn(), cookieDelete: vi.fn() }));
vi.mock('../supabase/server', () => ({ createServerAuthClient: async () => ({ auth: { signUp: h.signup, signInWithPassword: h.login, signOut: h.signOut, resetPasswordForEmail: h.recovery, updateUser: h.update, resend: h.resend } }) }));
vi.mock('../auth-session', () => ({ getIdentity: h.identity }));
vi.mock('../auth-navigation', () => ({ getJournalAccess: vi.fn(), accessDestination: vi.fn() }));
vi.mock('../profile', () => ({ getOrCreateProfile: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: h.cookieDelete, getAll: () => [] }) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error('REDIRECT:' + url); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe('auth mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3137';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
    process.env.AUTH_SIGNUP_ENABLED = 'true';
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    h.signOut.mockResolvedValue({ error: null });
    h.signup.mockResolvedValue({ data: { session: null }, error: null });
    h.recovery.mockResolvedValue({ error: null });
    h.resend.mockResolvedValue({ error: null });
    h.identity.mockResolvedValue({ ok: false, status: 401, error: 'Please sign in.' });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('refuses signup when the rollout flag is disabled', async () => {
    process.env.AUTH_SIGNUP_ENABLED = 'false';
    const result = await signup({}, form({ email: 'a@example.test', password: 'long-password', confirmPassword: 'long-password' }));
    expect(result.error).toBeTruthy();
    expect(h.signup).not.toHaveBeenCalled();
  });
  it('does not grant entry when confirmation is unexpectedly disabled', async () => {
    h.signup.mockResolvedValue({ data: { session: { access_token: 'unexpected' } }, error: null });
    const result = await signup({}, form({ email: 'a@example.test', password: 'long-password', confirmPassword: 'long-password' }));
    expect(result.error).toBeTruthy();
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('acknowledges a duplicate signup without revealing account existence', async () => {
    h.signup.mockResolvedValue({ data: null, error: { code: 'user_already_exists' } });
    await expect(signup({}, form({ email: 'a@example.test', password: 'long-password', confirmPassword: 'long-password' }))).rejects.toThrow('REDIRECT:/check-email');
  });
  it('uses the same recovery acknowledgement for absent and existing addresses', async () => {
    const one = await forgotPassword({}, form({ email: 'exists@example.test' }));
    const two = await forgotPassword({}, form({ email: 'absent@example.test' }));
    expect(one.message).toBeTruthy();
    expect(two).toEqual(one);
  });
  it('requires a verified server identity before changing passwords', async () => {
    const result = await resetPassword({}, form({ password: 'new-password', confirmPassword: 'new-password' }));
    expect(result.error).toBeTruthy();
    expect(h.update).not.toHaveBeenCalled();
  });
  const emailFlows = [
    { name: 'signup', action: signup, provider: h.signup },
    { name: 'resend', action: resendConfirmation, provider: h.resend },
    { name: 'recovery', action: forgotPassword, provider: h.recovery },
  ];
  const values = { email: 'a@example.test', password: 'long-password', confirmPassword: 'long-password' };

  describe.each(emailFlows)('$name email errors', ({ action, provider }) => {
    it.each([429, 400, undefined])('handles email limits without promising a reset time (status %s)', async (status) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      provider.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status, message: 'sensitive provider details' } });
      const result = await action({}, form(values));
      expect(result.error).toContain('Email sending is temporarily limited');
      expect(result.retryAfter).toBeUndefined();
      expect(result.message).toBeUndefined();
      expect(warn).toHaveBeenCalledWith('[auth] Email sending rate limit reached.', { code: 'over_email_send_rate_limit', status });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/a@example|sensitive provider/);
    });
    it.each([{ status: 429 }, { code: 'over_request_rate_limit' }])('handles general throttles without assuming a 60-second reset (%j)', async (error) => {
      provider.mockResolvedValue({ error });
      const result = await action({}, form(values));
      expect(result.error).toContain('Too many attempts');
      expect(result.retryAfter).toBeUndefined();
    });
    it('surfaces a failed CAPTCHA instead of acknowledging email delivery', async () => {
      provider.mockResolvedValue({ error: { status: 400, code: 'captcha_failed' } });
      const result = await action({}, form(values));
      expect(result.error).toContain('security check');
      expect(result.message).toBeUndefined();
    });
  });

  it.each([
    { name: 'resend', action: resendConfirmation, provider: h.resend },
    { name: 'recovery', action: forgotPassword, provider: h.recovery },
  ])('logs $name delivery outages without claiming an email was sent', async ({ action, provider }) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    provider.mockResolvedValue({ error: { status: 500, code: 'unexpected_failure', message: 'SMTP password secret' } });
    const result = await action({}, form(values));
    expect(result.error).toContain('Email delivery is temporarily unavailable');
    expect(result.retryAfter).toBeUndefined();
    expect(result.message).toBeUndefined();
    expect(log).toHaveBeenCalledWith('[auth] Email delivery unavailable.', { code: 'unexpected_failure', status: 500 });
  });

  it('keeps the local resend pause after a successful request', async () => {
    expect(await resendConfirmation({}, form(values))).toMatchObject({ message: expect.any(String), retryAfter: 60 });
    expect(await forgotPassword({}, form(values))).toMatchObject({ message: expect.any(String), retryAfter: 60 });
  });

  describe.each([...emailFlows, { name: 'login', action: login, provider: h.login }])('$name security check', ({ action, provider, name }) => {
    it.each(['', ' '.repeat(5), 'a'.repeat(2049)])('requires a valid token shape when Turnstile is configured', async (token) => {
      vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
      const result = await action({}, form({ ...values, 'cf-turnstile-response': token }));
      expect(result.error).toContain('complete the security check');
      expect(provider).not.toHaveBeenCalled();
    });
    it('rejects a missing token before making an Auth request', async () => {
      vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
      expect((await action({}, form(values))).error).toContain('security check');
      expect(provider).not.toHaveBeenCalled();
    });
    it('passes the token to Supabase for actual verification', async () => {
      vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
      provider.mockResolvedValue({ error: { code: 'captcha_failed', status: 400 } });
      await action({}, form({ ...values, 'cf-turnstile-response': 'single-use-token' }));
      const options = name === 'recovery' ? provider.mock.calls[0][1] : provider.mock.calls[0][0].options;
      expect(options).toMatchObject({ captchaToken: 'single-use-token' });
    });
  });
});
