import { NextResponse } from 'next/server';
import { fetchCalendar } from '@/lib/api/calendar';
import { marketFeatures } from '@/lib/market/features';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!marketFeatures.calendar) return NextResponse.json({ error: 'Calendar is disabled' }, { status: 404 });
  return NextResponse.json(await fetchCalendar(), { headers: { 'Cache-Control': 'no-store' } });
}
