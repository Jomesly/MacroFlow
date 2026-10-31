import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { login } from '@/app/auth/actions';
import { safeJournalDestination } from '@/lib/auth-validation';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; notice?: string }> }) {
  const params = await searchParams;
  return (
    <AuthShell title="Sign in to your journal" description="Your trades, history and analytics, together in one personal journal.">
      {params.notice === 'password-updated' && <p role="status" className="mb-4 text-sm text-emerald-400">Password updated. Sign in with your new password.</p>}
      <AuthForm action={login} mode="login" next={safeJournalDestination(params.next ?? null)} />
    </AuthShell>
  );
}
