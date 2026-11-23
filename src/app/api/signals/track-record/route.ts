import { NextResponse } from 'next/server';
import { FORECAST_VERSION } from '@/lib/forecast';
import { summarizeTrackRecord } from '@/lib/signals/track-record';
import { fromDbRow, type SignalDbRow } from '@/lib/signals/types';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };

/**
 * Public, measured results of A/B signals for the current forecast version. When the
 * table cannot be read, the record is empty: nothing may look proven without data.
 */
export async function GET() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data, error } = await supabase.from('signal_outcomes').select('*')
      .eq('forecast_version', FORECAST_VERSION).in('outcome', ['win', 'loss']).range(0, 9999);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as SignalDbRow[]).map(fromDbRow);
    return NextResponse.json({ available: true, ...summarizeTrackRecord(rows, FORECAST_VERSION) }, { headers: HEADERS });
  } catch (error) {
    console.error('[signals] track record unavailable', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ available: false, ...summarizeTrackRecord([], FORECAST_VERSION) }, { headers: HEADERS });
  }
}
