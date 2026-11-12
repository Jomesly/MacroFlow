import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '../../app/api/account/route';

const h = vi.hoisted(() => ({ identity: vi.fn(), verify: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), remove: vi.fn() }));
vi.mock('../auth-session', () => ({ getIdentity: h.identity }));
vi.mock('../supabase', () => ({ supabase: { rpc: h.rpc, auth: { admin: { deleteUser: h.remove } } } }));
vi.mock('../supabase/config', () => ({ publicSupabaseConfig: () => ({ url: 'http://127.0.0.1:55421', key: 'local-test' }) }));
vi.mock('../supabase/server', () => ({ createServerAuthClient: async () => ({ auth: { signOut: h.signOut } }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: h.verify, signOut: h.signOut } }) }));

const request = (headers: Record<string, string> = {}) => new NextRequest('http://localhost:3001/api/account', {
  method: 'DELETE', headers: { origin: 'http://localhost:3001', 'x-journal-user': 'owner', ...headers },
  body: JSON.stringify({ password: 'local-test-password', confirmation: 'DELETE' }),
});

describe('password-verified account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3001';
    h.identity.mockResolvedValue({ ok: true, user: { id: 'owner', email: 'owner@example.test' } });
    h.verify.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
    h.signOut.mockResolvedValue({ error: null });
    h.rpc.mockResolvedValue({ error: null });
    h.remove.mockResolvedValue({ error: null });
  });

  it('does not verify a password or mutate data for a stale browser owner', async () => {
    expect((await DELETE(request({ 'x-journal-user': 'another-owner' }))).status).toBe(409);
    expect(h.verify).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  });

  it('does not freeze or delete data when password verification fails', async () => {
    h.verify.mockResolvedValue({ data: { user: null }, error: { status: 400 } });
    expect((await DELETE(request())).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  });

  it('rejects a reauthentication result for a different identity', async () => {
    h.verify.mockResolvedValue({ data: { user: { id: 'different-owner' } }, error: null });
    expect((await DELETE(request())).status).toBe(409);
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  });

  it('does not call Auth deletion when database preparation fails', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'BILLING_REVIEW_REQUIRED' } });
    expect((await DELETE(request())).status).toBe(409);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('returns a recoverable pending state if Auth fails after the database freeze', async () => {
    h.remove.mockResolvedValue({ error: { status: 503 } });
    const response = await DELETE(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ deletionPending: true, code: 'DELETION_PENDING' });
    expect(h.rpc).toHaveBeenCalledWith('prepare_journal_user_deletion', { p_user_id: 'owner' });
    expect(h.remove).toHaveBeenCalledWith('owner');
  });

  it('clears this project’s auth cookies after deletion', async () => {
    const response = await DELETE(request({ cookie: 'sb-127-auth-token.0=local-token; sb-127-auth-token-code-verifier=local-verifier; unrelated=keep' }));
    expect(response.status).toBe(200);
    expect(response.cookies.get('sb-127-auth-token.0')?.maxAge).toBe(0);
    expect(response.cookies.get('sb-127-auth-token-code-verifier')?.maxAge).toBe(0);
    expect(response.cookies.has('unrelated')).toBe(false);
  });
});
