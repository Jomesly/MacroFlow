import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Revoke an API key (sets revoked_at; the row is kept for audit). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const keyId = Number(id);
  if (!Number.isInteger(keyId)) {
    return NextResponse.json({ error: 'Invalid key id' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('journal_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .select('id');

  if (error) {
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 503 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
