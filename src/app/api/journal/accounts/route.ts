import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** List the current user's connected broker accounts + active API keys. */
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  const [{ data: accounts, error: accountsError }, { data: keys, error: keysError }] =
    await Promise.all([
      supabase
        .from('broker_accounts')
        .select('id,account_login,server,currency,source,ea_version,last_seen_at')
        .eq('user_id', auth.userId)
        .order('last_seen_at', { ascending: false }),
      supabase
        .from('journal_api_keys')
        .select('id,key_prefix,created_at,last_used_at')
        .eq('user_id', auth.userId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ]);

  if (accountsError || keysError) {
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 503 });
  }

  return NextResponse.json({
    accounts: accounts ?? [],
    keys: keys ?? [],
    timestamp: new Date().toISOString(),
  });
}
