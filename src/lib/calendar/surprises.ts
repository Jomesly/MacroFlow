import { releaseToEvent } from '../api/calendar';
import type { CalendarEvent, MacroEvent } from '../types';
import { parseFeedNumber } from './us-actuals';
import type { ArchivedForecast } from './archive';

/**
 * Turn released US calendar rows into scorer surprises. A forecast only counts if it was
 * archived before the release, so a consensus seen after the fact can never be scored.
 */
export function buildCalendarSurprises(events: CalendarEvent[], forecasts: Map<string, ArchivedForecast>, asOf: string): MacroEvent[] {
  const surprises: MacroEvent[] = [];
  for (const event of events) {
    const archived = forecasts.get(event.id);
    const seen = Date.parse(archived?.firstSeenAt ?? '');
    const released = Date.parse(event.time);
    const cutoff = Date.parse(asOf);
    if (event.currency !== 'USD' || !archived || !Number.isFinite(seen) || !Number.isFinite(released) || !Number.isFinite(cutoff) || seen >= released || released > cutoff) continue;
    const actual = parseFeedNumber(event.actual);
    const estimate = parseFeedNumber(archived.forecast);
    if (actual === null || estimate === null) continue;
    const surprise = releaseToEvent({ event: event.title, country: 'US', time: event.time, actual, estimate, impact: event.impact }, asOf, 'ForexFactory + FRED');
    if (surprise) surprises.push(surprise);
  }
  return surprises;
}
