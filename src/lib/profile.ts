import 'server-only';
import { supabase } from './supabase';
import { profileSchema, type ProfileInput } from './auth-validation';

export interface JournalProfile {
  id: string;
  display_name: string | null;
  reporting_timezone: string;
  onboarding_completed_at: string | null;
}

const columns = 'id,display_name,reporting_timezone,onboarding_completed_at';

export async function getOrCreateProfile(userId: string): Promise<JournalProfile> {
  let result = await supabase.from('profiles').select(columns).eq('id', userId).maybeSingle();
  if (result.error) throw new Error('Profile is unavailable. Please retry shortly.');
  if (!result.data) {
    // Repair preferences only. This must never create or restore a journal grant.
    const { error } = await supabase.from('profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error('Profile could not be prepared. Please retry.');
    result = await supabase.from('profiles').select(columns).eq('id', userId).maybeSingle();
  }
  if (result.error || !result.data) throw new Error('Profile is unavailable. Please retry shortly.');
  return result.data as JournalProfile;
}

export async function saveOnboarding(userId: string, input: ProfileInput): Promise<void> {
  const preferences = profileSchema.parse(input);
  const current = await getOrCreateProfile(userId);
  const { error } = await supabase.from('profiles').update({
    display_name: preferences.displayName || null,
    reporting_timezone: preferences.reportingTimezone,
    onboarding_completed_at: current.onboarding_completed_at ?? new Date().toISOString(),
  }).eq('id', userId);
  if (error) throw new Error('Profile could not be saved. Please retry.');
}
