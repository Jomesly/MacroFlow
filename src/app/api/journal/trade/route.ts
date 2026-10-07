import { NextRequest, NextResponse } from 'next/server';
import { createTrade, listTrades, JournalStorageError, JournalValidationError } from '@/lib/journal';
import { TradeApiResponse, TradesApiResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const trades = await listTrades();
    const response: TradesApiResponse = {
      trades,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof JournalStorageError) {
      return NextResponse.json({ error: 'Journal storage unavailable' }, { status: 503 });
    }
    console.error('[journal] GET /api/journal/trade failed:', err);
    return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  try {
    const trade = await createTrade(body as Record<string, unknown>);
    const response: TradeApiResponse = { trade };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    if (err instanceof JournalValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JournalStorageError) {
      return NextResponse.json({ error: 'Journal storage unavailable' }, { status: 503 });
    }
    console.error('[journal] POST /api/journal/trade failed:', err);
    return NextResponse.json({ error: 'Failed to save trade' }, { status: 500 });
  }
}
