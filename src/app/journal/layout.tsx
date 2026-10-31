import type { Metadata } from 'next';
import Link from 'next/link';
import { requireJournalPageAccess } from '@/lib/auth-navigation';
import SignOutForm from '@/components/auth/SignOutForm';
import JournalSessionBoundary from '@/components/auth/JournalSessionBoundary';

export const metadata: Metadata = {
  title: 'MacroFlow — Trading Journal',
  description:
    'Log and review your trades — symbols, entries, exits, results, and setup tags in one place.',
};

export default async function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await requireJournalPageAccess();
  return <JournalSessionBoundary key={userId} userId={userId}>
    <div className="border-b border-zinc-800 px-6 py-2">
      <div className="mx-auto max-w-6xl flex flex-wrap justify-end items-center gap-4 text-xs">
        <span className="text-emerald-400">Free beta</span>
        <Link href="/journal/welcome" className="text-zinc-400 hover:text-white">Journal preferences</Link>
        <SignOutForm />
      </div>
    </div>
    {children}
  </JournalSessionBoundary>;
}
