import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, filterEvents, groupByLocalDay, loadFilters, localDay, todayCounts } from '../calendar/view';
import type { CalendarEvent } from '../types';

const tz = 'Asia/Manila';
const now = new Date('2026-11-10T02:00:00.000Z'); // 10:00 on Nov 10 in Manila
const event = (title: string, time: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: `${title}:${time}`, title, currency: 'USD',
  time, impact: 'high', forecast: null, previous: null, actual: null, affects: [], ...over });

const events = [
  event('Today USD high', '2026-11-10T13:30:00.000Z'),
  event('Today GBP medium', '2026-11-10T07:00:00.000Z', { currency: 'GBP', impact: 'medium' }),
  event('Today USD low', '2026-11-10T14:00:00.000Z', { impact: 'low' }),
  event('Today JPY high', '2026-11-10T00:30:00.000Z', { currency: 'JPY' }),
  event('Tomorrow in Manila', '2026-11-10T16:30:00.000Z'),
];

describe('calendar filters', () => {
  it('falls back to defaults for missing or corrupt storage', () => {
    expect(loadFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(loadFilters({ getItem: () => 'not json' })).toEqual(DEFAULT_FILTERS);
    expect(loadFilters({ getItem: () => JSON.stringify({ impacts: ['severe'], currencies: 'USD', range: 'month' }) })).toEqual(DEFAULT_FILTERS);
    expect(loadFilters({ getItem: () => JSON.stringify({ impacts: ['low'], currencies: ['EUR'], range: 'week' }) }))
      .toEqual({ impacts: ['low'], currencies: ['EUR'], range: 'week' });
  });
  it('defaults to high and medium USD/GBP for today', () => {
    expect(DEFAULT_FILTERS).toEqual({ impacts: ['high', 'medium'], currencies: ['USD', 'GBP'], range: 'today' });
  });
  it('assigns days in the viewer time zone, not the US date', () => {
    expect(localDay('2026-11-10T16:30:00.000Z', tz)).toBe('2026-11-11');
  });
  it('filters by impact, currency and range', () => {
    expect(filterEvents(events, DEFAULT_FILTERS, now, tz).map(e => e.title)).toEqual(['Today USD high', 'Today GBP medium']);
    const week = filterEvents(events, { ...DEFAULT_FILTERS, range: 'week' }, now, tz).map(e => e.title);
    expect(week).toContain('Tomorrow in Manila');
    expect(filterEvents(events, { impacts: ['low'], currencies: ['USD'], range: 'today' }, now, tz).map(e => e.title)).toEqual(['Today USD low']);
  });
  it('groups by local day in time order', () => {
    const groups = groupByLocalDay(filterEvents(events, { ...DEFAULT_FILTERS, range: 'week' }, now, tz), tz);
    expect(groups.map(g => g.day)).toEqual(['2026-11-10', '2026-11-11']);
    expect(groups[0].events.map(e => e.title)).toEqual(['Today GBP medium', 'Today USD high']);
  });
  it('counts only today high and medium events for the chosen currencies', () => {
    expect(todayCounts(events, ['USD', 'GBP'], now, tz)).toEqual({ high: 1, medium: 1 });
    expect(todayCounts(events, ['JPY'], now, tz)).toEqual({ high: 1, medium: 0 });
  });
});
