import type { Metadata } from 'next';
import Link from 'next/link';
import { requireJournalPageAccess } from '@/lib/auth-navigation';
import SignOutForm from '@/components/auth/SignOutForm';
import JournalSessionBoundary from '@/components/auth/JournalSessionBoundary';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { SlidersHorizontal } from '@phosphor-icons/react/ssr';

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
    <WorkspaceHeader active="journal">
        <Link href="/journal/welcome" className="journal-preferences text-zinc-400 hover:text-white" aria-label="Journal preferences"><SlidersHorizontal size={15} className="mr-2" aria-hidden="true" />Preferences</Link>
        <Link href="/account" className="journal-preferences text-zinc-400 hover:text-white">Account settings</Link>
        <SignOutForm />
    </WorkspaceHeader>
    {children}
  </JournalSessionBoundary>;
}
