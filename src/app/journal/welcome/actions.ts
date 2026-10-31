'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getJournalAccess, accessDestination } from '@/lib/auth-navigation';
import { profileSchema, type AuthFormState } from '@/lib/auth-validation';
import { saveOnboarding } from '@/lib/profile';

export async function completeOnboarding(_previous: AuthFormState, data: FormData): Promise<AuthFormState> {
  const access = await getJournalAccess();
  if (!access.ok) {
    if (access.status === 503) return { error: access.error };
    redirect(accessDestination(access));
  }
  if (data.get('expectedUser') !== access.userId) redirect('/login');
  const input = profileSchema.safeParse({
    displayName: data.get('displayName') ?? '',
    reportingTimezone: data.get('reportingTimezone'),
    destination: data.get('destination'),
  });
  if (!input.success) return { error: input.error.issues[0].message };
  try {
    await saveOnboarding(access.userId, input.data);
  } catch {
    return { error: 'Your preferences could not be saved. Please retry.' };
  }
  revalidatePath('/journal', 'layout');
  redirect('/journal?tab=' + (input.data.destination === 'accounts' ? 'accounts' : 'log'));
}
