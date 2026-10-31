import AuthShell from '@/components/auth/AuthShell';
import WelcomeForm from '@/components/auth/WelcomeForm';
import { requireJournalPageAccess } from '@/lib/auth-navigation';
import { getOrCreateProfile } from '@/lib/profile';
import { redirect } from 'next/navigation';

export default async function WelcomePage() {
  const { userId } = await requireJournalPageAccess();
  let profile;
  try { profile = await getOrCreateProfile(userId); } catch { redirect('/journal-access?reason=profile'); }
  return (
    <AuthShell title={profile.onboarding_completed_at ? 'Your journal preferences' : 'Welcome to your journal'} description="Your personal journal is ready. Start with a manual trade or connect MT5 to sync closed trades. No payment is required during beta.">
      <WelcomeForm profile={profile} />
    </AuthShell>
  );
}
