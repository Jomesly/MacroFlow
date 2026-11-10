import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { SETUP_TAGS } from '@/lib/types';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await supabase.from('journal_setup_tags').select('name').eq('user_id', auth.userId).order('name').limit(500);
  if (error) return NextResponse.json({ error: 'Setup tags unavailable.' }, { status: 503 });
  const names = new Map<string, string>();
  for (const name of [...SETUP_TAGS, ...(data ?? []).map(tag => tag.name)]) if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  return NextResponse.json({ tags: [...names.values()] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
