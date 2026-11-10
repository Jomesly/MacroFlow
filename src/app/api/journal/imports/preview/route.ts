import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { previewImport } from '@/lib/journal-imports';
import { TradingAccountError } from '@/lib/trading-account-types';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 6 * 1024 * 1024) throw new TradingAccountError('Choose a CSV smaller than 2 MB.', 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new TradingAccountError('Invalid request body.', 400); }
    return NextResponse.json({ preview: await previewImport(auth.userId, body) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Import preview is unavailable.' }, { status: error instanceof TradingAccountError ? error.status : 503 });
  }
}
