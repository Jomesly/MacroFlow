import type { CalendarEvent, CalendarImpact } from '../types';

export interface CalendarFilters { impacts: CalendarImpact[]; currencies: string[]; range: 'today' | 'week' }

export const FILTERS_KEY = 'macroflow:calendar-filters:v1';
export const ALL_IMPACTS: CalendarImpact[] = ['high', 'medium', 'low', 'holiday'];
export const DEFAULT_FILTERS: CalendarFilters = { impacts: ['high', 'medium'], currencies: ['USD', 'GBP'], range: 'today' };

export function loadFilters(storage: Pick<Storage, 'getItem'> | null): CalendarFilters {
  try {
    const parsed = JSON.parse(storage?.getItem(FILTERS_KEY) ?? 'null');
    const impactsOk = Array.isArray(parsed?.impacts) && parsed.impacts.every((i: unknown) => ALL_IMPACTS.includes(i as CalendarImpact));
    const currenciesOk = Array.isArray(parsed?.currencies) && parsed.currencies.every((c: unknown) => typeof c === 'string');
    if (!impactsOk || !currenciesOk || !['today', 'week'].includes(parsed.range)) return DEFAULT_FILTERS;
    return { impacts: parsed.impacts, currencies: parsed.currencies, range: parsed.range };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** YYYY-MM-DD of an instant in the viewer's time zone. */
export function localDay(time: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}

/** "This week" is the whole weekly feed; "today" is the viewer's local day. */
export function filterEvents(events: CalendarEvent[], filters: CalendarFilters, now: Date, timeZone: string): CalendarEvent[] {
  const today = localDay(now, timeZone);
  return events.filter(event => filters.impacts.includes(event.impact) && filters.currencies.includes(event.currency)
    && (filters.range === 'week' || localDay(event.time, timeZone) === today));
}

export function groupByLocalDay(events: CalendarEvent[], timeZone: string): { day: string; label: string; events: CalendarEvent[] }[] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of [...events].sort((a, b) => a.time.localeCompare(b.time))) {
    const day = localDay(event.time, timeZone);
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  return [...groups].map(([day, list]) => ({ day, events: list,
    label: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(list[0].time)) }));
}

export function todayCounts(events: CalendarEvent[], currencies: string[], now: Date, timeZone: string): { high: number; medium: number } {
  const today = filterEvents(events, { impacts: ['high', 'medium'], currencies, range: 'today' }, now, timeZone);
  return { high: today.filter(e => e.impact === 'high').length, medium: today.filter(e => e.impact === 'medium').length };
}
