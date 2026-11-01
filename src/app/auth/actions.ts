'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerAuthClient } from '@/lib/supabase/server';
import { getIdentity } from '@/lib/auth-session';
import { getJournalAccess, accessDestination } from '@/lib/auth-navigation';
import { getOrCreateProfile } from '@/lib/profile';
import {
  applicationOrigin, emailSchema, loginSchema, passwordSchema, signupSchema,
  safeJournalDestination, type AuthFormState,
} from '@/lib/auth-validation';

const acknowledgement = 'If this email can receive the requested link, it will arrive shortly. Check your inbox and spam folder.';

function authError(error: { status?: number; code?: string }, fallback: string): AuthFormState {
  if (error.code === 'over_email_send_rate_limit') {
    // Log only provider metadata: never email addresses, credentials or tokens.
    console.warn('[auth] Email sending rate limit reached.', { code: error.code, status: error.status });
    return { error: 'Email sending is temporarily limited. Please try again later. If this continues, contact support.' };
  }
  if (error.status === 429 || error.code?.includes('rate_limit')) {
    // Auth errors do not supply a reset time. A 60-second timer would imply one.
    return { error: 'Too many attempts. Please wait a few minutes before trying again.' };
  }
  if (error.code === 'captcha_failed') return { error: 'Verification failed or expired. Please complete the security check and try again.' };
  if (error.code === 'weak_password') return { error: 'Choose a stronger password that meets the journal password requirements.' };
  return { error: fallback };
}

function captchaOptions(data: FormData): { captchaToken?: string } | null {
  if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return {};
  const token = data.get('cf-turnstile-response');
  // Supabase validates the token with the Turnstile secret configured in its dashboard.
  return typeof token === 'string' && token.trim() && token.length <= 2048
    ? { captchaToken: token } : null;
}

const captchaRequired: AuthFormState = { error: 'Please complete the security check and try again.' };

function isPublicAuthError(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || !!error.code?.includes('rate_limit') || error.code === 'captcha_failed';
}

function emailDeliveryError(error?: { status?: number; code?: string }): AuthFormState {
  console.error('[auth] Email delivery unavailable.', { code: error?.code, status: error?.status });
  return { error: 'Email delivery is temporarily unavailable. Please try again later.' };
}

async function clearAuthCookies() {
  const store = await cookies();
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
  const prefix = 'sb-' + project + '-auth-token';
  store.getAll().filter(({ name }) => name === prefix || name.startsWith(prefix + '.') || name === prefix + '-code-verifier')
    .forEach(({ name }) => store.delete(name));
  store.delete('sb-access-token');
}

export async function signup(_previous: AuthFormState, data: FormData): Promise<AuthFormState> {
  if (process.env.AUTH_SIGNUP_ENABLED !== 'true') return { error: 'New registrations are not open yet. Please try again later.' };
  const input = signupSchema.safeParse(Object.fromEntries(['email', 'password', 'confirmPassword'].map((name) => [name, data.get(name)])));
  if (!input.success) return { error: input.error.issues[0].message };
  const captcha = captchaOptions(data);
  if (!captcha) return captchaRequired;
  try {
    const auth = await createServerAuthClient();
    const { data: result, error } = await auth.auth.signUp({
      email: input.data.email, password: input.data.password,
      options: { emailRedirectTo: applicationOrigin() + '/auth/confirm', ...captcha },
    });
    if (error && error.code !== 'user_already_exists') return authError(error, 'Registration could not be completed. Please retry shortly.');
    if (result?.session) {
      await auth.auth.signOut({ scope: 'local' });
      await clearAuthCookies();
      console.error('[auth] Signup unexpectedly returned a session. Enable email confirmation.');
      return { error: 'Registration is temporarily unavailable. Please contact the site owner.' };
    }
  } catch {
    return { error: 'Registration is temporarily unavailable. Please retry shortly.' };
  }
  redirect('/check-email');
}

export async function login(_previous: AuthFormState, data: FormData): Promise<AuthFormState> {
  const input = loginSchema.safeParse({ email: data.get('email'), password: data.get('password') });
  if (!input.success) return { error: input.error.issues[0].message };
  const captcha = captchaOptions(data);
  if (!captcha) return captchaRequired;
  let unverified = false;
  try {
    const auth = await createServerAuthClient();
    const { error } = await auth.auth.signInWithPassword({ ...input.data, options: captcha });
    if (error?.code === 'email_not_confirmed') unverified = true;
    else if (error) return authError(error, 'Sign-in failed. Check your email and password, then try again.');
    (await cookies()).delete('sb-access-token');
  } catch {
    return { error: 'Sign-in is temporarily unavailable. Please retry shortly.' };
  }
  if (unverified) redirect('/check-email');
  const access = await getJournalAccess();
  if (!access.ok) redirect(accessDestination(access));
  let profile;
  try {
    profile = await getOrCreateProfile(access.userId);
  } catch {
    return { error: 'Your profile could not be loaded. Retry sign-in shortly.' };
  }
  if (!profile.onboarding_completed_at) redirect('/journal/welcome');
  revalidatePath('/journal', 'layout');
  redirect(safeJournalDestination(typeof data.get('next') === 'string' ? String(data.get('next')) : null));
}

export async function resendConfirmation(_previous: AuthFormState, data: FormData): Promise<AuthFormState> {
  const input = emailSchema.safeParse({ email: data.get('email') });
  if (!input.success) return { error: input.error.issues[0].message };
  const captcha = captchaOptions(data);
  if (!captcha) return captchaRequired;
  try {
    const auth = await createServerAuthClient();
    const { error } = await auth.auth.resend({ type: 'signup', email: input.data.email, options: { emailRedirectTo: applicationOrigin() + '/auth/confirm', ...captcha } });
    if (error && isPublicAuthError(error)) return authError(error, 'Email delivery is temporarily unavailable. Please try again later.');
    // Some provider versions identify already-confirmed/absent users; conceal those states.
    if (error && (error.status ?? 500) >= 500) return emailDeliveryError(error);
    return { message: acknowledgement, retryAfter: 60 };
  } catch {
    return emailDeliveryError();
  }
}

export async function forgotPassword(_previous: AuthFormState, data: FormData): Promise<AuthFormState> {
  const input = emailSchema.safeParse({ email: data.get('email') });
  if (!input.success) return { error: input.error.issues[0].message };
  const captcha = captchaOptions(data);
  if (!captcha) return captchaRequired;
  try {
    const auth = await createServerAuthClient();
    const { error } = await auth.auth.resetPasswordForEmail(input.data.email, { redirectTo: applicationOrigin() + '/auth/confirm', ...captcha });
    if (error && isPublicAuthError(error)) return authError(error, 'Email delivery is temporarily unavailable. Please try again later.');
    if (error && (error.status ?? 500) >= 500) return emailDeliveryError(error);
    return { message: acknowledgement, retryAfter: 60 };
  } catch {
    return emailDeliveryError();
  }
}

export async function resetPassword(_previous: AuthFormState, data: FormData): Promise<AuthFormState> {
  const input = passwordSchema.safeParse({ password: data.get('password'), confirmPassword: data.get('confirmPassword') });
  if (!input.success) return { error: input.error.issues[0].message };
  const identity = await getIdentity();
  if (!identity.ok) return { error: identity.status === 503 ? identity.error : 'Open a fresh password reset link, or sign in before changing your password.' };
  try {
    const auth = await createServerAuthClient();
    const { error } = await auth.auth.updateUser({ password: input.data.password });
    if (error) return authError(error, 'Password could not be changed. Request a new reset link and try again.');
    await auth.auth.signOut({ scope: 'local' });
    await clearAuthCookies();
  } catch {
    return { error: 'Password change is temporarily unavailable. Please retry.' };
  }
  revalidatePath('/journal', 'layout');
  redirect('/login?notice=password-updated');
}

export async function signOut(): Promise<void> {
  try {
    const auth = await createServerAuthClient();
    await auth.auth.signOut({ scope: 'local' });
  } catch {
    // Still discard this browser's cookies when the provider cannot be reached.
  }
  await clearAuthCookies();
  revalidatePath('/journal', 'layout');
  redirect('/login');
}
