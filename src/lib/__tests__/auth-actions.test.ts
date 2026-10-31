import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signup, forgotPassword, resetPassword, resendConfirmation } from '../../app/auth/actions';

const h = vi.hoisted(() => ({ signup: vi.fn(), signOut: vi.fn(), recovery: vi.fn(), update: vi.fn(), identity: vi.fn(), resend: vi.fn(), cookieDelete: vi.fn() }));
vi.mock('../supabase/server', () => ({ createServerAuthClient: async () => ({ auth: { signUp: h.signup, signOut: h.signOut, resetPasswordForEmail: h.recovery, updateUser: h.update, resend: h.resend } }) }));
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
    h.signOut.mockResolvedValue({ error: null });
    h.signup.mockResolvedValue({ data: { session: null }, error: null });
    h.recovery.mockResolvedValue({ error: null });
    h.resend.mockResolvedValue({ error: null });
    h.identity.mockResolvedValue({ ok: false, status: 401, error: 'Please sign in.' });
  });
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
  it('returns a usable rate-limit delay for resend', async () => {
    h.resend.mockResolvedValue({ error: { status: 429 } });
    expect(await resendConfirmation({}, form({ email: 'a@example.test' }))).toMatchObject({ retryAfter: 60 });
  });
});
