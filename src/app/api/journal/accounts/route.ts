import { NextRequest } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { BrokerAccount } from '@/lib/account-management';
import { accountFailure, accountResponse } from '@/lib/account-api';

export const dynamic = 'force-dynamic';

/** List the current user's connected broker accounts + active API keys. */
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  const [{ data: accounts, error: accountsError }, { data: keys, error: keysError }] =
    await Promise.all([
      supabase.rpc('list_managed_broker_accounts', { p_user_id: auth.userId }),
      supabase
        .from('journal_api_keys')
        .select('id,key_prefix,created_at,last_used_at')
        .eq('user_id', auth.userId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ]);

  if (accountsError || keysError) {
    return accountFailure(accountsError ?? keysError!);
  }

  const all = (accounts ?? []) as BrokerAccount[];
  return accountResponse({
    accounts: all.filter((a) => a.lifecycle !== 'removed'),
    removedAccounts: all.filter((a) => a.lifecycle === 'removed'),
    keys: keys ?? [],
    timestamp: new Date().toISOString(),
  });
}
