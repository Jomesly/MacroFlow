import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { createTradingAccount, listTradingAccounts, TradingAccountError } from '@/lib/trading-accounts';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ accounts: await listTradingAccounts(auth.userId) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Accounts are unavailable.' }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    const text = await request.text();
    if (text.length > 8192) return NextResponse.json({ error: 'Account details are too long.' }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers }); }
    return NextResponse.json({ account: await createTradingAccount(auth.userId, body) }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Account could not be created.' }, { status: error instanceof TradingAccountError ? error.status : 503, headers });
  }
}
