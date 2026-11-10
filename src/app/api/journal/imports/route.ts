import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { importHistory } from '@/lib/journal-imports';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json({ batches: await importHistory(auth.userId) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch { return NextResponse.json({ error: 'Import history is unavailable.' }, { status: 503 }); }
}
