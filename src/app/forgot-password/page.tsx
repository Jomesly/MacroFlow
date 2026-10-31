import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { forgotPassword } from '@/app/auth/actions';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <AuthShell title="Reset your password" description="Enter your email and we will send a recovery link if the address belongs to an account.">
      {params.error === 'invalid-link' && <p role="alert" className="mb-4 text-sm text-amber-400">This recovery link is invalid, expired or already used. Request a fresh link.</p>}
      <AuthForm action={forgotPassword} mode="forgot" />
    </AuthShell>
  );
}
