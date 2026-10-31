import { redirect } from 'next/navigation';
import JournalView, { type JournalTab } from '@/components/JournalView';
import { requireJournalPageAccess } from '@/lib/auth-navigation';
import { getOrCreateProfile } from '@/lib/profile';

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { userId } = await requireJournalPageAccess();
  let profile;
  try { profile = await getOrCreateProfile(userId); } catch { redirect('/journal-access?reason=profile'); }
  if (!profile.onboarding_completed_at) redirect('/journal/welcome');
  const params = await searchParams;
  const tab: JournalTab = params.tab === 'history' || params.tab === 'analytics' || params.tab === 'accounts' ? params.tab : 'log';
  return <JournalView initialTab={tab} />;
}
