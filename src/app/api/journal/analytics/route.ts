import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { listTrades } from '@/lib/journal';
import { computeAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * GET /api/journal/analytics?account=1,2&symbol=XAUUSD&tag=Sweep&from=...&to=...
 * TradeZella-core aggregates over the current user's trades.
 */
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const accountParam = parseList(params.get('account'));
    const accountIds = accountParam
      ?.map(Number)
      .filter((n) => Number.isInteger(n));

    const trades = await listTrades(auth.userId);
    const analytics = computeAnalytics(trades, {
      accountIds,
      symbols: parseList(params.get('symbol')),
      tags: parseList(params.get('tag')),
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    });

    return NextResponse.json({ analytics, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 });
  }
}
