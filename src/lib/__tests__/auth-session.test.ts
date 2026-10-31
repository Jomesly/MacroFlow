import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getIdentity } from '../auth-session';

function client(result: unknown, rejects = false) {
  return { auth: { getUser: () => rejects ? Promise.reject(result) : Promise.resolve(result) } } as SupabaseClient;
}

describe('server identity verification', () => {
  it('uses the verified identity, without trusting a cookie user payload', async () => {
    expect(await getIdentity(client({ data: { user: { id: 'verified-a' } }, error: null }))).toMatchObject({ ok: true, user: { id: 'verified-a' } });
  });
  it('distinguishes invalid credentials from an Auth outage', async () => {
    expect(await getIdentity(client({ data: { user: null }, error: { status: 401 } }))).toMatchObject({ status: 401 });
    expect(await getIdentity(client({ data: { user: null }, error: { name: 'AuthSessionMissingError' } }))).toMatchObject({ status: 401 });
    expect(await getIdentity(client({ data: { user: null }, error: { status: 503 } }))).toMatchObject({ status: 503 });
    expect(await getIdentity(client(new Error('fetch failed'), true))).toMatchObject({ status: 503 });
  });
});
