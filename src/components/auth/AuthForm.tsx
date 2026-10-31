'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuthFormState } from '@/lib/auth-validation';
import { announceSessionChange } from '@/lib/journal-session';

export const AUTH_FIELD = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
export const AUTH_BUTTON = 'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';

type Mode = 'login' | 'signup' | 'resend' | 'forgot' | 'reset';

export default function AuthForm({ action, mode, next = '/journal' }: {
  action: (previous: AuthFormState, data: FormData) => Promise<AuthFormState>;
  mode: Mode;
  next?: string;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!state.retryAfter) return;
    const end = Date.now() + state.retryAfter * 1000;
    const id = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [state]);
  const needsEmail = mode !== 'reset';
  const needsPassword = mode === 'login' || mode === 'signup' || mode === 'reset';
  const confirmsPassword = mode === 'signup' || mode === 'reset';
  const labels: Record<Mode, string> = {
    login: 'Sign in', signup: 'Create free account', resend: 'Resend confirmation',
    forgot: 'Send reset link', reset: 'Save new password',
  };
  return (
    <form action={submit} onSubmit={() => {
      if (mode === 'login' || mode === 'reset' || mode === 'signup') announceSessionChange();
    }} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {needsEmail && (
        <div>
          <label htmlFor="auth-email" className="block text-sm text-zinc-300 mb-1.5">Email</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} className={AUTH_FIELD} />
        </div>
      )}
      {needsPassword && (
        <div>
          <label htmlFor="auth-password" className="block text-sm text-zinc-300 mb-1.5">{mode === 'reset' ? 'New password' : 'Password'}</label>
          <input id="auth-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} maxLength={mode === 'login' ? 1024 : 128} aria-describedby={confirmsPassword ? 'password-help' : undefined} className={AUTH_FIELD} />
          {confirmsPassword && <p id="password-help" className="mt-1.5 text-xs text-zinc-500">Use at least 8 characters. Your password must also meet the account security requirements.</p>}
        </div>
      )}
      {confirmsPassword && (
        <div>
          <label htmlFor="auth-confirm" className="block text-sm text-zinc-300 mb-1.5">Confirm password</label>
          <input id="auth-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={AUTH_FIELD} />
        </div>
      )}
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-emerald-400">{state.message}</p>}
      <button disabled={pending || remaining > 0} type="submit" className={AUTH_BUTTON + ' w-full'}>
        {pending ? 'Please wait…' : remaining > 0 ? 'Try again in ' + remaining + 's' : labels[mode]}
      </button>
      <nav className="flex flex-wrap justify-between gap-3 pt-2 text-xs text-blue-400">
        {mode !== 'login' && <Link href="/login" className="hover:underline">Back to sign in</Link>}
        {mode === 'login' && <><Link href="/signup" className="hover:underline">Create an account</Link><Link href="/forgot-password" className="hover:underline">Forgot password?</Link></>}
        {mode === 'resend' && <Link href="/forgot-password" className="hover:underline">Reset password</Link>}
      </nav>
    </form>
  );
}
