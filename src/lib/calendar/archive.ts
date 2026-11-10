import type { CalendarEvent } from '../types';
import { parseFeedNumber } from './us-actuals';

export interface ArchivedForecast { forecast: string; firstSeenAt: string }
export interface ForecastArchive { forecasts: Map<string, ArchivedForecast>; status: 'ok' | 'failed' }

// Legacy rows were timestamped by callers and cannot prove pre-release knowledge.
// A separate namespace starts trustworthy evidence without modifying or deleting them.
const ARCHIVE_PREFIX = 'consensus-v2:';

/**
 * Freeze the first usable consensus. Later feed revisions never replace it.
 * Omit first_seen_at so the database timestamps receipt, independent of caller asOf.
 * Never throws: without the archive the calendar displays but surprises are excluded.
 */
export async function archiveForecasts(events: CalendarEvent[]): Promise<ForecastArchive> {
  const firstSeen = new Map<string, ArchivedForecast>();
  const failed: ForecastArchive = { forecasts: new Map(), status: 'failed' };
  if (!events.length) return { forecasts: firstSeen, status: 'ok' };
  try {
    const { supabase } = await import('../supabase');
    const rows = events.filter(event => parseFeedNumber(event.forecast) !== null).map(event => ({ id: `${ARCHIVE_PREFIX}${event.id}`, title: event.title, currency: event.currency, scheduled_at: event.time,
      impact: event.impact, forecast: event.forecast, previous: event.previous }));
    if (rows.length) {
      const { error } = await supabase.from('calendar_forecasts').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) return failed;
    }
    const { data, error: readError } = await supabase.from('calendar_forecasts').select('id, forecast, first_seen_at').in('id', events.map(event => `${ARCHIVE_PREFIX}${event.id}`));
    if (readError || !data) return failed;
    for (const row of data as { id: string; forecast: string | null; first_seen_at: string }[]) {
      const seen = Date.parse(row.first_seen_at);
      if (!row.id.startsWith(ARCHIVE_PREFIX) || !Number.isFinite(seen) || row.forecast === null || parseFeedNumber(row.forecast) === null) continue;
      firstSeen.set(row.id.slice(ARCHIVE_PREFIX.length), { forecast: row.forecast, firstSeenAt: new Date(seen).toISOString() });
    }
  } catch {
    // Supabase not configured or unreachable.
    return failed;
  }
  return { forecasts: firstSeen, status: 'ok' };
}
