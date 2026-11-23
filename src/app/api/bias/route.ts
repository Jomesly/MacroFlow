import { NextRequest, NextResponse } from 'next/server';
import { ALL_SYMBOLS } from '@/lib/engine';
import { FORECAST_VERSION } from '@/lib/forecast';
import { buildBiasSnapshot } from '@/lib/bias-snapshot';
import { AssetSymbol, BiasApiResponse } from '@/lib/types';
import { getHistory, recordDailySnapshot } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolParam = searchParams.get('symbol')?.toUpperCase() as AssetSymbol | null;

  const symbol = symbolParam && ALL_SYMBOLS.includes(symbolParam) ? symbolParam : undefined;

  const { asOf, results, meta } = await buildBiasSnapshot(symbol);

  const data = await Promise.all(
    results.map(async (r) => {
      if (meta.source === 'live' && !meta.stale) await recordDailySnapshot(r.symbol, r.direction, r.biasScore, FORECAST_VERSION);
      const history = await getHistory(r.symbol, FORECAST_VERSION);
      return { ...r, history };
    })
  );

  const response: BiasApiResponse = {
    data,
    timestamp: meta.cachedAt,
    source: meta.source,
    sourceHealth: meta.sourceHealth,
    stale: meta.stale,
    dxy: meta.dxy,
    nextEvent: meta.nextEvent && Date.parse(meta.nextEvent.date) > Date.parse(asOf) ? meta.nextEvent : null,
    disclaimer:
      'This is not financial advice. Use this dashboard for informational purposes only. Always conduct your own research before trading.',
  };

  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
}
