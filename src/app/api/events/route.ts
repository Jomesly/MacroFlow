import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/events';
import { EventsApiResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { events, source } = await getEvents();

  const response: EventsApiResponse = {
    events,
    timestamp: new Date().toISOString(),
    source,
  };

  return NextResponse.json(response);
}
