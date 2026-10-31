import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { resendConfirmation } from '@/app/auth/actions';

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <AuthShell title="Check your email" description="Open the confirmation email to verify your address and enter your free beta journal. Check your spam folder too.">
      {params.error === 'invalid-link' && <p role="alert" className="mb-4 text-sm text-amber-400">This confirmation link is invalid, expired or already used. Sign in if you have already verified, or request a fresh email below.</p>}
      {params.error === 'browser-mismatch' && <p role="alert" className="mb-4 text-sm text-amber-400">Open this link in the same browser where you requested it. If your email is already verified, sign in with your password instead.</p>}
      <p className="mb-4 text-xs text-zinc-500">Need another confirmation? Enter the email you registered with.</p>
      <AuthForm action={resendConfirmation} mode="resend" />
    </AuthShell>
  );
}
