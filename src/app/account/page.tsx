import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getIdentity } from '@/lib/auth-session';
import { supabase } from '@/lib/supabase';
import AccountSettings from '@/components/AccountSettings';
import SignOutForm from '@/components/auth/SignOutForm';

export const metadata: Metadata = { title: 'Account settings — MacroFlow' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const identity = await getIdentity();
  if (!identity.ok) {
    if (identity.status === 401) redirect('/login');
    return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-xl text-white">Account settings unavailable</h1><p role="alert" className="mt-4 text-zinc-400">{identity.error}</p><Link href="/account" className="mt-4 inline-block text-blue-400">Retry</Link></main>;
  }
  const { data, error } = await supabase.from('journal_access').select('deletion_requested_at').eq('user_id', identity.user.id).maybeSingle();
  return <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4 text-xs">
      <Link href="/journal?tab=accounts" className="text-blue-400 hover:text-blue-300">← Trading journal</Link>
      <SignOutForm />
    </div>
    <h1 className="text-2xl font-semibold tracking-tight text-white">Account settings</h1>
    <p className="mb-8 mt-2 text-sm text-zinc-500">Manage your MacroFlow account.</p>
    {error && <p role="alert" className="mb-5 text-sm text-amber-300">Account status could not be loaded. Any deletion request will be verified again before proceeding.</p>}
    <AccountSettings userId={identity.user.id} email={identity.user.email ?? ''} deletionPending={!!data?.deletion_requested_at} />
  </main>;
}
