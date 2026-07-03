import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/events';
import { calculateBias, ALL_SYMBOLS } from '@/lib/engine';
import { fetchUpcomingEconomicCalendar } from '@/lib/api/fmp';
import { AssetSymbol, BiasApiResponse, DxyContext } from '@/lib/types';
import { getHistory, recordDailySnapshot } from '@/lib/redis';

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

  const { events, source, cachedAt, sourceHealth, stale } = await getEvents();
  const results = calculateBias(events, symbol);

  const dxy = getDxyContext(events);
  const upcomingEvents = await fetchUpcomingEconomicCalendar();
  const nextEvent = upcomingEvents[0] ?? null;

  const data = await Promise.all(
    results.map(async (r) => {
      await recordDailySnapshot(r.symbol, r.direction, r.biasScore);
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
    nextEvent,
    disclaimer:
      'This is not financial advice. Use this dashboard for informational purposes only. Always conduct your own research before trading.',
  };

  return NextResponse.json(response);
}
