import { NextResponse } from 'next/server';
import { fetchMacroContext } from '@/lib/api/macro-context';
import { marketFeatures } from '@/lib/market/features';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!marketFeatures.macro) return NextResponse.json({ error: 'Macro context is disabled' }, { status: 404 });
  return NextResponse.json(await fetchMacroContext(), { headers: { 'Cache-Control': 'no-store' } });
}
