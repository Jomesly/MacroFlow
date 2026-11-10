import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { tradeBatchSchema, normalizeBatch } from '@/lib/journal-batch-types';
import { journalRpc } from '@/lib/journal-rpc';
import { rowToTrade, type TradeRow } from '@/lib/journal';
import { TradingAccountError } from '@/lib/trading-account-types';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    const text = await request.text();
    if (text.length > 64_000) return NextResponse.json({ error: 'Trade details are too long.' }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers }); }
    const parsed = tradeBatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check trade details.', issues: parsed.error.issues.map(issue => ({ path: issue.path, message: issue.message })) }, { status: 400, headers });
    const input = normalizeBatch(parsed.data);
    const result = await journalRpc<{ groupId: string; trades: TradeRow[] }>('create_journal_trade_batch', { p_user: auth.userId, p_request: input.requestId, p_payload: input });
    return NextResponse.json({ groupId: result.groupId, trades: result.trades.map(rowToTrade) }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Trade could not be saved. Please retry.' }, { status: error instanceof TradingAccountError ? error.status : 503, headers });
  }
}
