import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/events';
import { calculateBias, ALL_SYMBOLS } from '@/lib/engine';
import { biasRules } from '@/lib/rules';
import { AssetSymbol, BiasApiResponse, DxyContext, EventCategory, UpcomingEvent } from '@/lib/types';
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

function getAffectedSymbols(category: EventCategory, value: string): string[] {
  const affected = biasRules
    .filter((r) => r.eventCategory === category && r.eventValue === value)
    .map((r) => r.symbol);
  return [...new Set(affected)];
}

function getNextEvent(events: Awaited<ReturnType<typeof getEvents>>['events']): UpcomingEvent | null {
  const now = new Date();
  const upcoming = events
    .filter((e) => e.impact === 'high' || e.impact === 'medium')
    .filter((e) => new Date(e.timestamp) > now)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (upcoming.length === 0) return null;

  const next = upcoming[0];
  const affects = getAffectedSymbols(next.category, next.value);
  const name = next.title.replace(/^[A-Z]{2,3}\s+/, '').replace(/\s*—.*$/, '');
  const country = next.title.match(/^([A-Z]{2,3})\s+/)?.[1] ?? '';

  return {
    name,
    country,
    date: next.timestamp,
    impact: next.impact as 'high' | 'medium',
    affects,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolParam = searchParams.get('symbol')?.toUpperCase() as AssetSymbol | null;

  const symbol = symbolParam && ALL_SYMBOLS.includes(symbolParam) ? symbolParam : undefined;

  const { events, source, cachedAt } = await getEvents();
  const results = calculateBias(events, symbol);

  const dxy = getDxyContext(events);
  const nextEvent = getNextEvent(events);

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
    dxy,
    nextEvent,
    disclaimer:
      'This is not financial advice. Use this dashboard for informational purposes only. Always conduct your own research before trading.',
  };

  return NextResponse.json(response);
}
