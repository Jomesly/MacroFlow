import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/events';
import { calculateBias, ALL_SYMBOLS } from '@/lib/engine';
import { AssetSymbol } from '@/lib/types';
import { BiasApiResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolParam = searchParams.get('symbol')?.toUpperCase() as AssetSymbol | null;

  const symbol = symbolParam && ALL_SYMBOLS.includes(symbolParam) ? symbolParam : undefined;

  const { events, source } = await getEvents();
  const results = calculateBias(events, symbol);

  const response: BiasApiResponse = {
    data: results,
    timestamp: new Date().toISOString(),
    source,
    disclaimer:
      'This is not financial advice. Use this dashboard for informational purposes only. Always conduct your own research before trading.',
  };

  return NextResponse.json(response);
}
