import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import { getJournalAccess, accessDestination } from '@/lib/auth-navigation';
import SignOutForm from '@/components/auth/SignOutForm';

export default async function JournalAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const access = await getJournalAccess();
  const params = await searchParams;
  if (!access.ok && (access.status === 401 || access.code === 'EMAIL_UNVERIFIED')) redirect(accessDestination(access));
  if (access.ok && params.reason !== 'profile') redirect('/journal');
  const unavailable = !access.ok && access.status === 503;
  return (
    <AuthShell title={unavailable || params.reason === 'profile' ? 'Your journal is temporarily unavailable' : 'Journal access unavailable'} description={access.ok ? 'Your profile could not be loaded. Please retry shortly. If this continues, contact the site owner.' : access.error}>
      <div className="space-y-4 text-sm">
        <p className="text-zinc-400">Free beta access does not require a payment. If your access has been disabled, contact the site owner.</p>
        <Link href={params.reason === 'profile' ? '/journal/welcome' : '/journal'} className="block text-blue-400 underline">Retry journal access</Link>
        <SignOutForm />
      </div>
    </AuthShell>
  );
}
