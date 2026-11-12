import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { hashApiKey, keyPrefix } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

const MAX_ACTIVE_KEYS = 3;

/** Generate a new EA API key. The raw key is returned ONCE — store only the hash. */
export async function POST(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  const rawKey = `mf_${randomBytes(32).toString('base64url')}`;
  const { data, error } = await supabase.rpc('manage_journal_api_key', {
    p_user_id: auth.userId, p_action: 'create', p_hash: hashApiKey(rawKey), p_prefix: keyPrefix(rawKey),
  });
  if (error?.message === 'API_KEY_LIMIT') return NextResponse.json(
    { error: `Key limit reached (${MAX_ACTIVE_KEYS} active keys). Revoke one first.` }, { status: 400 });

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to create key' }, { status: 503 });
  }

  return NextResponse.json({ key: rawKey, ...(data as object) }, { status: 201 });
}
