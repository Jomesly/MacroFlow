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

  const { count, error: countError } = await supabase
    .from('journal_api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .is('revoked_at', null);

  if (countError) {
    return NextResponse.json({ error: 'Failed to create key' }, { status: 503 });
  }
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      { error: `Key limit reached (${MAX_ACTIVE_KEYS} active keys). Revoke one first.` },
      { status: 400 }
    );
  }

  const rawKey = `mf_${randomBytes(32).toString('base64url')}`;
  const { data, error } = await supabase
    .from('journal_api_keys')
    .insert({
      user_id: auth.userId,
      key_hash: hashApiKey(rawKey),
      key_prefix: keyPrefix(rawKey),
    })
    .select('id,key_prefix,created_at')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to create key' }, { status: 503 });
  }

  return NextResponse.json({ key: rawKey, ...(data as object) }, { status: 201 });
}
