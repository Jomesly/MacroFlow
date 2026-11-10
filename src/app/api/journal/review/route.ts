import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { listTrades } from '@/lib/journal';
import { computeWeeklyReview, weekStart } from '@/lib/weekly-review';
import { TradingAccountError } from '@/lib/trading-account-types';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const date =
    request.nextUrl.searchParams.get('week') ??
    new Date().toISOString().slice(0, 10);
  const account = request.nextUrl.searchParams.get('account');
  if (
    account !== null &&
    (!/^\d+$/.test(account) ||
      !Number.isSafeInteger(Number(account)) ||
      Number(account) <= 0)
  )
    return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
  try {
    weekStart(date);
  } catch {
    return NextResponse.json({ error: 'Invalid week date' }, { status: 400 });
  }
  try {
    const review = computeWeeklyReview(
      await listTrades(auth.userId, request.nextUrl.searchParams.get('tradingAccount') ?? undefined),
      date,
      account === null ? undefined : Number(account),
    );
    return NextResponse.json(
      { review },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof TradingAccountError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: 'Weekly review is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
