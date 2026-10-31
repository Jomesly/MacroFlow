import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrCreateProfile, saveOnboarding } from '../profile';

const h = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { from: (table: string) => {
  if (table !== 'profiles') throw new Error('Profile operations must never repair access');
  return {
    select: () => ({ eq: (field: string, id: string) => { h.eq(field, id); return { maybeSingle: h.read }; } }),
    upsert: h.insert,
    update: (fields: unknown) => { h.update(fields); return { eq: () => Promise.resolve({ error: null }) }; },
  };
} } }));

const saved = { id: 'owner-a', display_name: 'Saved', reporting_timezone: 'Asia/Manila', onboarding_completed_at: '2026-01-01T00:00:00Z' };

describe('journal profile lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); h.read.mockResolvedValue({ data: saved, error: null }); h.insert.mockResolvedValue({ error: null }); });
  it('returns existing preferences unchanged', async () => {
    expect(await getOrCreateProfile('owner-a')).toEqual(saved);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.eq).toHaveBeenCalledWith('id', 'owner-a');
  });
  it('repairs only a missing profile with conflict-safe insertion', async () => {
    h.read.mockResolvedValueOnce({ data: null, error: null });
    expect(await getOrCreateProfile('owner-a')).toEqual(saved);
    expect(h.insert).toHaveBeenCalledWith({ id: 'owner-a' }, { onConflict: 'id', ignoreDuplicates: true });
  });
  it('preserves the original completion date on repeated onboarding', async () => {
    await saveOnboarding('owner-a', { displayName: 'New name', reportingTimezone: 'UTC', destination: 'log' });
    expect(h.update).toHaveBeenCalledWith({ display_name: 'New name', reporting_timezone: 'UTC', onboarding_completed_at: '2026-01-01T00:00:00Z' });
  });
  it('fails on unavailable storage instead of seeding data or permissions', async () => {
    h.read.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(getOrCreateProfile('owner-a')).rejects.toThrow('Profile');
    expect(h.insert).not.toHaveBeenCalled();
  });
});
