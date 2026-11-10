import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { renameTradingAccount, TradingAccountError } from '@/lib/trading-accounts';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const text = await request.text();
    if (text.length > 8192) return NextResponse.json({ error: 'Nickname is too long.' }, { status: 413, headers });
    let input: unknown;
    try { input = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers }); }
    const { id } = await context.params;
    return NextResponse.json({ account: await renameTradingAccount(auth.userId, id, input) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Nickname could not be saved.' }, { status: error instanceof TradingAccountError ? error.status : 503, headers });
  }
}
