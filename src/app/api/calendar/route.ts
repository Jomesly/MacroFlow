import { NextResponse } from 'next/server';
import { getCalendar } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { events, fetchedAt, archiveStatus } = await getCalendar();
    return NextResponse.json({ events, fetchedAt, archiveStatus, source: 'ForexFactory' });
  } catch {
    return NextResponse.json({ error: 'Calendar unavailable' }, { status: 503 });
  }
}
