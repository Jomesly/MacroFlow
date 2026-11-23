import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { computeAnalytics } from '@/lib/analytics';
import { loadAnalyticsView } from '@/lib/analytics-view';
import { journalFeatures } from '@/lib/journal-features';
import { screenshotCountsByTrade } from '@/lib/screenshots';
import { tradeDay } from '@/lib/trade-dates';
import { TradingAccountError } from '@/lib/trading-account-types';
import { currencyPrecision } from '@/lib/account-money';

export const dynamic = 'force-dynamic';

/**
 * GET /api/journal/analytics?account=1,2&symbol=XAUUSD&tag=Sweep&from=...&to=...
 * TradeZella-core aggregates over the current user's trades.
 */
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  try {
    const { trades, moneyComparable, currency } = await loadAnalyticsView(auth.userId, request.nextUrl.searchParams);
    const analytics = computeAnalytics(trades, {}, currency ? currencyPrecision(currency) : 2);

    // Mark calendar days that have screenshots. This is a hint only: a
    // screenshot outage must never take the analytics page down with it.
    if (journalFeatures.screenshots && analytics.calendar.length) {
      try {
        const counts = await screenshotCountsByTrade(auth.userId);
        if (counts.size) {
          const byDay = new Map<string, number>();
          for (const trade of trades) {
            const count = trade.result !== null ? counts.get(trade.id) : undefined;
            if (count) byDay.set(tradeDay(trade), (byDay.get(tradeDay(trade)) ?? 0) + count);
          }
          for (const day of analytics.calendar) {
            const count = byDay.get(day.date);
            if (count) day.screenshots = count;
          }
        }
      } catch (error) {
        console.error('[journal] analytics screenshot counts failed:', error);
      }
    }

    return NextResponse.json({ analytics, moneyComparable, currency, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof TradingAccountError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 });
  }
}
