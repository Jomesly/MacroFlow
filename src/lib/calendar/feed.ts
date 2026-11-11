import { getCached, setCache } from '../api/cache';
import type { CalendarEvent, CalendarImpact } from '../types';
import { ALL_SYMBOLS } from '../engine';

export const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const IMPACTS: Record<string, CalendarImpact> = { High: 'high', Medium: 'medium', Low: 'low', Holiday: 'holiday' };
const AFFECTS: Record<string, string[]> = {
  USD: ALL_SYMBOLS,
  GBP: ['GBPUSD'],
  EUR: ['EURUSD'], JPY: ['USDJPY'], CHF: ['USDCHF'], AUD: ['AUDUSD'], CAD: ['USDCAD'], NZD: ['NZDUSD'],
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Validate the public weekly feed row by row; one bad row never drops the rest. */
export function parseWeeklyFeed(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) throw new Error('Calendar feed is not a list');
  const events: CalendarEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const { title, country, date, impact, forecast, previous } = row as Record<string, unknown>;
    const name = text(title);
    const currency = text(country)?.toUpperCase();
    const level = typeof impact === 'string' ? IMPACTS[impact] : undefined;
    const parsed = typeof date === 'string' ? Date.parse(date) : NaN;
    if (!name || !currency || !level || !Number.isFinite(parsed)) continue;
    const time = new Date(parsed).toISOString();
    events.push({ id: `${currency}:${name}:${time}`, title: name, currency, time, impact: level,
      forecast: text(forecast), previous: text(previous), actual: null, affects: AFFECTS[currency] ?? [] });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchWeeklyFeed(): Promise<CalendarEvent[]> {
  const cached = await getCached<CalendarEvent[]>('calendar_feed_v2');
  if (cached) return cached;
  const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000), cache: 'no-store',
    headers: { 'User-Agent': 'MacroFlow dashboard' } });
  if (!response.ok) throw new Error(`Calendar feed HTTP ${response.status}`);
  const events = parseWeeklyFeed(await response.json());
  if (!events.length) throw new Error('Calendar feed returned no usable events');
  await setCache('calendar_feed_v2', events, 3_600_000);
  return events;
}
