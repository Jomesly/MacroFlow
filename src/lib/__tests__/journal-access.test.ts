import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { checkJournalAccess } from '../journal-access';

vi.mock('server-only', () => ({}));

const user = { id: 'user-a', email_confirmed_at: '2026-10-31T00:00:00Z', user_metadata: {} } as User;

describe('verified journal access', () => {
  const lookup = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle: lookup }));
  const from = vi.fn(() => ({ select: () => ({ eq }) }));
  const sb = { from } as unknown as SupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockResolvedValue({ data: { status: 'active' }, error: null });
  });

  it('allows a verified beta user using only their own grant', async () => {
    expect(await checkJournalAccess(sb, user)).toEqual({ ok: true, userId: 'user-a' });
    expect(eq).toHaveBeenCalledWith('user_id', 'user-a');
  });

  it('rejects missing identities before reading grants', async () => {
    expect(await checkJournalAccess(sb, null)).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects unverified identities even with an active grant', async () => {
    expect(await checkJournalAccess(sb, { ...user, email_confirmed_at: undefined })).toMatchObject({ status: 403, code: 'EMAIL_UNVERIFIED' });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a banned owner before journal writes', async () => {
    expect(await checkJournalAccess(sb, { ...user, banned_until: '2999-01-01T00:00:00Z' } as User)).toMatchObject({ status: 401 });
    expect(from).not.toHaveBeenCalled();
  });

  it('does not let signup metadata override revocation', async () => {
    lookup.mockResolvedValue({ data: { status: 'revoked' }, error: null });
    expect(await checkJournalAccess(sb, { ...user, user_metadata: { status: 'active', plan: 'paid' } })).toMatchObject({ status: 403, code: 'JOURNAL_ACCESS_REVOKED' });
  });

  it('treats missing grants as provisioning failures without creating one', async () => {
    lookup.mockResolvedValue({ data: null, error: null });
    expect(await checkJournalAccess(sb, user)).toMatchObject({ status: 503, code: 'ACCESS_CHECK_UNAVAILABLE' });
  });

  it('fails closed on database errors and transport failures', async () => {
    lookup.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    expect(await checkJournalAccess(sb, user)).toMatchObject({ status: 503 });
    lookup.mockRejectedValueOnce(new Error('network'));
    expect(await checkJournalAccess(sb, user)).toMatchObject({ status: 503 });
  });
});
