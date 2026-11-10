import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireJournalAccess } from '@/lib/auth';
import { journalRpc } from '@/lib/journal-rpc';
import { TradingAccountError } from '@/lib/trading-account-types';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const text = await request.text();
    let input: unknown;
    try { input = text.length <= 1000 ? JSON.parse(text) : null; } catch { input = null; }
    const parsed = z.object({ expectedUntouched: z.number().int().min(0).max(1000) }).strict().safeParse(input);
    if (!z.uuid().safeParse(id).success || !parsed.success) throw new TradingAccountError('Review the import before undoing it.', 400);
    const result = await journalRpc('undo_journal_import', { p_user: auth.userId, p_batch: id, p_expected: parsed.data.expectedUntouched });
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Import could not be undone.' }, { status: error instanceof TradingAccountError ? error.status : 503 }); }
}
