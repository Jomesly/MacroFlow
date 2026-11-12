import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrCreateProfile, saveOnboarding } from '../profile';

const h = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), eq: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: h.rpc, from: (table: string) => {
  if (table !== 'profiles') throw new Error('Profile operations must never repair access');
  return {
    select: () => ({ eq: (field: string, id: string) => { h.eq(field, id); return { maybeSingle: h.read }; } }),
  };
} } }));

const saved = { id: 'owner-a', display_name: 'Saved', reporting_timezone: 'Asia/Manila', onboarding_completed_at: '2026-01-01T00:00:00Z' };

describe('journal profile lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); h.read.mockResolvedValue({ data: saved, error: null }); h.rpc.mockResolvedValue({ data: saved, error: null }); });
  it('returns existing preferences unchanged', async () => {
    expect(await getOrCreateProfile('owner-a')).toEqual(saved);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.eq).toHaveBeenCalledWith('id', 'owner-a');
  });
  it('repairs only a missing profile with conflict-safe insertion', async () => {
    h.read.mockResolvedValueOnce({ data: null, error: null });
    expect(await getOrCreateProfile('owner-a')).toEqual(saved);
    expect(h.rpc).toHaveBeenCalledWith('save_journal_profile', { p_user_id: 'owner-a' });
  });
  it('delegates atomic onboarding completion to the database', async () => {
    await saveOnboarding('owner-a', { displayName: 'New name', reportingTimezone: 'UTC', destination: 'log' });
    expect(h.rpc).toHaveBeenCalledWith('save_journal_profile', { p_user_id: 'owner-a', p_values: { display_name: 'New name', reporting_timezone: 'UTC' } });
  });
  it('fails on unavailable storage instead of seeding data or permissions', async () => {
    h.read.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(getOrCreateProfile('owner-a')).rejects.toThrow('Profile');
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
