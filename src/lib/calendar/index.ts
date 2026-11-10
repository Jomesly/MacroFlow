import { getCached, setCache } from '../api/cache';
import type { CalendarEvent, MacroEvent, UpcomingEvent } from '../types';
import { getArchivedForecasts } from './archive-cache';
import { fetchWeeklyFeed } from './feed';
import { buildCalendarSurprises } from './surprises';
import { fetchUsActual, US_RELEASES } from './us-actuals';

export interface CalendarResult { events: CalendarEvent[]; surprises: MacroEvent[]; fetchedAt: string; archiveStatus: 'ok' | 'failed' }

/** First-release value for one event, cached: found for 7 days, missing retried after 15 minutes. */
async function actualFor(event: CalendarEvent, apiKey: string): Promise<string | null> {
  const key = `calendar_actual_v1:${event.id}`;
  const cached = await getCached<{ actual: string | null }>(key);
  if (cached) return cached.actual;
  const actual = await fetchUsActual(event, apiKey);
  await setCache(key, { actual }, actual === null ? 15 * 60_000 : 7 * 86_400_000);
  return actual;
}

/** Feed → forecast archive → FRED actuals for released US releases → scorer surprises. Throws only if the feed fails. */
export async function getCalendar(asOf = new Date().toISOString()): Promise<CalendarResult> {
  const feed = await fetchWeeklyFeed();
  const archive = await getArchivedForecasts(feed);
  const apiKey = process.env.FRED_API_KEY;
  const events = await Promise.all(feed.map(async (event) => {
    const released = Date.parse(event.time) <= Date.parse(asOf);
    if (!apiKey || !released || event.currency !== 'USD' || !US_RELEASES[event.title]) return event;
    return { ...event, actual: await actualFor(event, apiKey) };
  }));
  return { events, surprises: buildCalendarSurprises(events, archive.forecasts, asOf), fetchedAt: new Date().toISOString(), archiveStatus: archive.status };
}

export function nextHighEvent(events: CalendarEvent[], asOf: string): UpcomingEvent | null {
  const next = events.find(event => event.impact === 'high' && event.affects.length > 0 && Date.parse(event.time) > Date.parse(asOf));
  return next ? { name: next.title, country: next.currency, date: next.time, impact: 'high', affects: next.affects } : null;
}
