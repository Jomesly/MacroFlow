import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { signup } from '@/app/auth/actions';

export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return (
    <AuthShell title="Start your trading journal" description="Log trades, review your history and analytics, and connect MT5. Free during beta, with no card or trial countdown. Verify your email to get started.">
      {process.env.AUTH_SIGNUP_ENABLED === 'true'
        ? <AuthForm action={signup} mode="signup" />
        : <p role="status" className="text-sm text-zinc-300">New registrations are not open yet. <Link href="/login" className="text-blue-400 underline">Sign in to an existing account</Link>.</p>}
    </AuthShell>
  );
}
