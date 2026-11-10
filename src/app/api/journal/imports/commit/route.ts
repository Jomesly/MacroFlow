import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { journalRpc } from '@/lib/journal-rpc';
import { importCommitSchema } from '@/lib/journal-import-types';
import { TradingAccountError } from '@/lib/trading-account-types';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    const text = await request.text();
    if (text.length > 30000) throw new TradingAccountError('Too many selected rows.', 400);
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new TradingAccountError('Invalid request body.', 400); }
    const parsed = importCommitSchema.safeParse(input);
    if (!parsed.success) throw new TradingAccountError('Choose the reviewed rows to import.', 400);
    const { id, rows, keepDuplicates } = parsed.data;
    const result = await journalRpc('commit_journal_import', { p_user: auth.userId, p_batch: id, p_rows: rows, p_keep: keepDuplicates });
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Import could not be saved.' }, { status: error instanceof TradingAccountError ? error.status : 503 }); }
}
