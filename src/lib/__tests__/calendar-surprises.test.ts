import { describe, expect, it, vi } from 'vitest';
import { buildCalendarSurprises } from '../calendar/surprises';
import type { CalendarEvent } from '../types';

vi.mock('../supabase', () => { throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'); });

const asOf = '2026-11-10T15:00:00.000Z';
const cpi: CalendarEvent = { id: 'USD:CPI m/m:2026-11-10T13:30:00.000Z', title: 'CPI m/m', currency: 'USD', time: '2026-11-10T13:30:00.000Z',
  impact: 'high', forecast: '0.3%', previous: '0.6%', actual: '0.5%', affects: ['XAUUSD'] };
const seenBefore = new Map([[cpi.id, { forecast: '0.3%', firstSeenAt: '2026-11-09T00:00:00.000Z' }]]);

describe('calendar surprises', () => {
  it('scores a release whose forecast was archived before it came out', () => {
    const [surprise] = buildCalendarSurprises([cpi], seenBefore, asOf);
    expect(surprise).toMatchObject({ evidenceType: 'surprise', category: 'inflation', value: 'high', country: 'US', sourceName: 'ForexFactory + FRED' });
  });
  it('keeps the original surprise direction when the feed revises its forecast after release', () => {
    const archived = new Map([[cpi.id, { forecast: '0.3%', firstSeenAt: '2026-11-09T00:00:00.000Z' }]]);
    const [surprise] = buildCalendarSurprises([{ ...cpi, forecast: '0.5%', actual: '0.4%' }], archived, asOf);
    expect(surprise).toMatchObject({ category: 'inflation', value: 'high' });
  });
  it('ignores a forecast first seen after the release', () => {
    expect(buildCalendarSurprises([cpi], new Map([[cpi.id, { forecast: '0.3%', firstSeenAt: '2026-11-10T14:00:00.000Z' }]]), asOf)).toEqual([]);
    expect(buildCalendarSurprises([cpi], new Map(), asOf)).toEqual([]);
  });
  it('ignores missing values, future releases and non-US currencies', () => {
    expect(buildCalendarSurprises([{ ...cpi, forecast: null }], seenBefore, asOf)).toHaveLength(1);
    expect(buildCalendarSurprises([{ ...cpi, actual: null }], seenBefore, asOf)).toEqual([]);
    expect(buildCalendarSurprises([cpi], seenBefore, '2026-11-10T13:00:00.000Z')).toEqual([]);
    expect(buildCalendarSurprises([{ ...cpi, currency: 'GBP' }], seenBefore, asOf)).toEqual([]);
  });
  it('rejects equal-release and malformed archive timestamps', () => {
    for (const firstSeenAt of [cpi.time, 'invalid']) {
      expect(buildCalendarSurprises([cpi], new Map([[cpi.id, { forecast: '0.3%', firstSeenAt }]]), asOf)).toEqual([]);
    }
  });
});

describe('forecast archive', () => {
  it('reports failure and excludes forecasts when Supabase is unavailable', async () => {
    const { archiveForecasts } = await import('../calendar/archive');
    await expect(archiveForecasts([cpi])).resolves.toEqual({ forecasts: new Map(), status: 'failed' });
  });
});
