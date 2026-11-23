import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { loadAnalyticsView } from '@/lib/analytics-view';
import { isCalendarDate, toDayTrade, tradesOnDay, type DayTradesResponse } from '@/lib/day-trades';
import { journalFeatures } from '@/lib/journal-features';
import { screenshotsForTrades } from '@/lib/screenshots';
import { TradingAccountError } from '@/lib/trading-account-types';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/journal/day?date=YYYY-MM-DD plus the analytics filters
 * (tradingAccount, account, symbol, tag, from, to).
 * The closed trades one P&L calendar day counts, with their saved screenshots.
 */
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const date = params.get('date');
  if (!isCalendarDate(date)) return NextResponse.json({ error: 'Choose a valid day' }, { status: 400, headers });

  try {
    const view = await loadAnalyticsView(auth.userId, params);
    const trades = tradesOnDay(view.trades, date);

    let status: DayTradesResponse['screenshots'] = journalFeatures.screenshots ? 'ready' : 'disabled';
    let images = new Map<string, DayTradesResponse['trades'][number]['screenshots']>();
    if (status === 'ready' && trades.length) {
      try {
        const saved = await screenshotsForTrades(auth.userId, trades.map((trade) => trade.id));
        images = new Map([...saved].map(([id, list]) => [id, list.map(({ id, slot, url, width, height }) => ({ id, slot, url, width, height }))]));
      } catch (error) {
        // Still show the day's trades; the panel explains images are unavailable.
        console.error(`[journal] day ${date} screenshots failed:`, error);
        status = 'unavailable';
      }
    }

    const body: DayTradesResponse = {
      date,
      trades: trades.map((trade) => toDayTrade(trade, images.get(trade.id))),
      screenshots: status,
      moneyComparable: view.moneyComparable,
      currency: view.currency,
    };
    return NextResponse.json(body, { headers });
  } catch (error) {
    if (error instanceof TradingAccountError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.error(`[journal] GET /api/journal/day failed:`, error);
    return NextResponse.json({ error: 'Could not load this day' }, { status: 500, headers });
  }
}
