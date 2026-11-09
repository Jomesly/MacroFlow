import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/events';
import { calculateBias, ALL_SYMBOLS } from '@/lib/engine';
import { AssetSymbol, BiasApiResponse, DxyContext } from '@/lib/types';
import { getHistory, recordDailySnapshot } from '@/lib/redis';
import { fetchCalendar, nextCalendarEvent } from '@/lib/api/calendar';
import { fetchRateSpread } from '@/lib/api/fred';
import { marketFeatures } from '@/lib/market/features';

export const dynamic = 'force-dynamic';

function getDxyContext(events: Awaited<ReturnType<typeof getEvents>>['events']): DxyContext | undefined {
  const dxyEvent = events.find((e) => e.id.startsWith('td-dxy-'));
  if (!dxyEvent) return;

  const descMatch = dxyEvent.description.match(/Current:\s*([\d.]+)/);
  const changeMatch = dxyEvent.description.match(/\(([\d.-]+)%\)/);
  const price = descMatch?.[1] ?? '';
  const percentChange = changeMatch ? parseFloat(changeMatch[1]) : 0;
  const status = percentChange >= 0 ? 'strengthening' : 'weakening';
  const summary = status === 'strengthening'
    ? 'Bearish pressure on Gold (XAUUSD) and GBP/USD today'
    : 'Bullish tailwind for Gold (XAUUSD) and GBP/USD today';

  return { price, percentChange, status, summary };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolParam = searchParams.get('symbol')?.toUpperCase() as AssetSymbol | null;

  const symbol = symbolParam && ALL_SYMBOLS.includes(symbolParam) ? symbolParam : undefined;

  const [{ events, source, cachedAt, sourceHealth, stale }, calendar, rateSpread] = await Promise.all([
    getEvents(), marketFeatures.calendar ? fetchCalendar() : Promise.resolve(null), fetchRateSpread(),
  ]);
  const results = calculateBias(events, symbol, rateSpread);
  // Fallback or outdated reads must not overwrite the recorded history.
  const recordable = source === 'live' && !stale;

  const dxy = getDxyContext(events);

  const data = await Promise.all(
    results.map(async (r) => {
      if (recordable) await recordDailySnapshot(r.symbol, r.direction, r.biasScore);
      const history = await getHistory(r.symbol);
      return { ...r, history };
    })
  );

  const response: BiasApiResponse = {
    data,
    timestamp: cachedAt,
    source,
    sourceHealth,
    stale,
    dxy,
    nextEvent: calendar ? nextCalendarEvent(calendar) : null,
    calendarStatus: calendar?.meta.status,
    disclaimer:
      'This is not financial advice. Use this dashboard for informational purposes only. Always conduct your own research before trading.',
  };

  return NextResponse.json(response);
}
