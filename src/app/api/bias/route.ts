import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/events';
import { ALL_SYMBOLS } from '@/lib/engine';
import { scoreMacroAlignment } from '@/lib/alignment';
import { selectEventsAsOf } from '@/lib/macro-context';
import { AssetSymbol, BiasApiResponse, DxyContext } from '@/lib/types';
import { getHistory, recordDailySnapshot } from '@/lib/redis';
import { estimateProbability } from '@/lib/probability/model';
import probabilityModel from '@/lib/probability/registry.json';

export const dynamic = 'force-dynamic';

function getDxyContext(events: Awaited<ReturnType<typeof getEvents>>['events']): DxyContext | undefined {
  const dxyEvent = events.find((e) => e.seriesId === 'DXY' && e.value !== 'neutral');
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

  const { events, source, cachedAt, sourceHealth, stale, context, nextEvent } = await getEvents();
  const asOf = new Date().toISOString();
  const results = scoreMacroAlignment(events, context, asOf, symbol);

  const dxy = getDxyContext(selectEventsAsOf(events, asOf));

  const data = await Promise.all(
    results.map(async (r) => {
      if (source === 'live' && !stale) await recordDailySnapshot(r.symbol, r.direction, r.biasScore);
      const history = await getHistory(r.symbol);
      const inputAge = Date.parse(asOf) - Date.parse(cachedAt);
      const probability = estimateProbability(r, probabilityModel, asOf, {
        source, sourceHealth, stale: stale || !Number.isFinite(inputAge) || inputAge < 0 || inputAge > 5 * 60_000,
      });
      // Macro signals follow the scorer's evidence and market-alignment gates.
      // Optional outcome calibration must not disable the working macro engine.
      const inputsHealthy = source === 'live' && !stale && !Object.values(sourceHealth).includes('failed')
        && Number.isFinite(inputAge) && inputAge >= 0 && inputAge <= 5 * 60_000;
      return { ...r, history, probability, signal: inputsHealthy ? r.signal : 'neutral' as const };
    })
  );

  const response: BiasApiResponse = {
    data,
    timestamp: cachedAt,
    source,
    sourceHealth,
    stale,
    dxy,
    nextEvent: nextEvent && Date.parse(nextEvent.date) > Date.parse(asOf) ? nextEvent : null,
    disclaimer:
      'This is not financial advice. Use this dashboard for informational purposes only. Always conduct your own research before trading.',
  };

  return NextResponse.json(response);
}
