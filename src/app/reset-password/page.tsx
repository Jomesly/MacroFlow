import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { resetPassword } from '@/app/auth/actions';
import { getIdentity } from '@/lib/auth-session';

export default async function ResetPasswordPage() {
  const identity = await getIdentity();
  return (
    <AuthShell title="Choose a new password" description="After saving your new password, sign in again to open your journal.">
      {identity.ok ? <AuthForm action={resetPassword} mode="reset" /> : (
        <div className="space-y-4 text-sm">
          <p role="alert" className="text-amber-400">{identity.status === 503 ? identity.error : 'Open a fresh recovery link from your email before changing your password.'}</p>
          <Link href="/forgot-password" className="text-blue-400 underline">Request a new reset link</Link>
        </div>
      )}
    </AuthShell>
  );
}
