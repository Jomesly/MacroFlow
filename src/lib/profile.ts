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
    result = await supabase.rpc('save_journal_profile', { p_user_id: userId });
  }
  if (result.error || !result.data) throw new Error('Profile is unavailable. Please retry shortly.');
  return result.data as JournalProfile;
}

export async function saveOnboarding(userId: string, input: ProfileInput): Promise<void> {
  const preferences = profileSchema.parse(input);
  const { error } = await supabase.rpc('save_journal_profile', { p_user_id: userId, p_values: {
    display_name: preferences.displayName || null,
    reporting_timezone: preferences.reportingTimezone,
  } });
  if (error) throw new Error('Profile could not be saved. Please retry.');
}
