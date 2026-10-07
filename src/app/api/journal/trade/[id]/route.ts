import { NextRequest, NextResponse } from 'next/server';
import { deleteTrade, updateTrade, JournalStorageError, JournalValidationError } from '@/lib/journal';
import { TradeApiResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing trade id' }, { status: 400 });
  }

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
    const trade = await updateTrade(id, body as Record<string, never>);
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }
    const response: TradeApiResponse = { trade };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof JournalValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JournalStorageError) {
      return NextResponse.json({ error: 'Journal storage unavailable' }, { status: 503 });
    }
    console.error(`[journal] PUT /api/journal/trade/${id} failed:`, err);
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing trade id' }, { status: 400 });
  }

  try {
    const deleted = await deleteTrade(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof JournalStorageError) {
      return NextResponse.json({ error: 'Journal storage unavailable' }, { status: 503 });
    }
    console.error(`[journal] DELETE /api/journal/trade/${id} failed:`, err);
    return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 });
  }
}
