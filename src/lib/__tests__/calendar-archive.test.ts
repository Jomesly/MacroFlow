import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';

const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: [] as Record<string, unknown>[], failed: false, readFailed: false }));
vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => undefined) }));
vi.mock('../calendar/feed', () => ({ fetchWeeklyFeed: vi.fn() }));
vi.mock('../calendar/us-actuals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../calendar/us-actuals')>()),
  fetchUsActual: vi.fn(async () => '0.4%'),
}));
vi.mock('../supabase', () => ({ supabase: { from: () => ({
  upsert: async (rows: Record<string, unknown>[]) => {
    db.writes.push(...rows);
    for (const row of rows) if (!db.rows.has(row.id as string)) db.rows.set(row.id as string, { first_seen_at: new Date().toISOString(), ...row });
    return { error: db.failed ? new Error('offline') : null };
  },
  select: () => ({ in: async (_column: string, ids: string[]) => ({ data: ids.flatMap(id => db.rows.has(id) ? [db.rows.get(id)] : []), error: db.readFailed ? new Error('private database error') : null }) }),
}) } }));

import { archiveForecasts } from '../calendar/archive';
import { buildCalendarSurprises } from '../calendar/surprises';
import { getCalendar } from '../calendar';
import { fetchWeeklyFeed } from '../calendar/feed';

const cpi: CalendarEvent = { id: 'cpi', title: 'CPI m/m', currency: 'USD', time: '2026-11-10T13:30:00.000Z', impact: 'high', forecast: '0.3%', previous: null, actual: '0.4%', affects: ['XAUUSD'] };

describe('point-in-time forecast archive', () => {
  beforeEach(() => { db.rows.clear(); db.writes.length = 0; db.failed = false; db.readFailed = false; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T13:29:00Z')); });
  it('uses database receipt time when a request spans release, even with a historical caller timestamp', async () => {
    vi.setSystemTime(new Date('2026-11-10T13:30:01Z'));
    // An extra historical argument must never influence the timestamp written to storage.
    const forecasts = await Reflect.apply(archiveForecasts, undefined, [[cpi], '2026-11-10T13:29:59Z']);
    expect(db.writes[0]).not.toHaveProperty('first_seen_at');
    expect(buildCalendarSurprises([cpi], forecasts.forecasts, '2026-11-10T14:00:00Z')).toEqual([]);
  });
  it('rejects the late forecast through the real service when feed retrieval crosses release time', async () => {
    vi.setSystemTime(new Date('2026-11-10T13:29:59Z'));
    vi.mocked(fetchWeeklyFeed).mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-11-10T13:30:01Z'));
      return [cpi];
    });
    const requestStart = new Date().toISOString();
    await getCalendar(requestStart);
    expect(db.writes[0]).not.toHaveProperty('first_seen_at');
    vi.mocked(fetchWeeklyFeed).mockResolvedValueOnce([cpi]);
    expect((await getCalendar('2026-11-10T14:00:00Z')).surprises).toEqual([]);
  });
  it('freezes the first usable consensus across later revisions', async () => {
    await archiveForecasts([cpi]);
    vi.setSystemTime(new Date('2026-11-10T14:00:00Z'));
    const changed = { ...cpi, forecast: '0.5%' };
    const forecasts = await archiveForecasts([changed]);
    expect(buildCalendarSurprises([changed], forecasts.forecasts, new Date().toISOString())[0]).toMatchObject({ value: 'high' });
  });
  it('does not authorize a forecast first supplied after release using an earlier null observation', async () => {
    await archiveForecasts([{ ...cpi, forecast: null }]);
    expect(db.writes).toHaveLength(0);
    vi.setSystemTime(new Date('2026-11-10T14:00:00Z'));
    const forecasts = await archiveForecasts([cpi]);
    expect(buildCalendarSurprises([cpi], forecasts.forecasts, new Date().toISOString())).toEqual([]);
  });
  it('still reads the frozen forecast if the current feed removes it', async () => {
    await archiveForecasts([cpi]);
    const withoutForecast = { ...cpi, forecast: null };
    const forecasts = await archiveForecasts([withoutForecast]);
    expect(buildCalendarSurprises([withoutForecast], forecasts.forecasts, '2026-11-10T14:00:00Z')[0]).toMatchObject({ value: 'high' });
  });
  it('does not trust legacy archive records with caller-provided timestamps', async () => {
    db.rows.set(cpi.id, { id: cpi.id, forecast: '0.3%', first_seen_at: '2026-11-09T00:00:00Z' });
    vi.setSystemTime(new Date('2026-11-10T14:00:00Z'));
    const forecasts = await archiveForecasts([cpi]);
    expect(buildCalendarSurprises([cpi], forecasts.forecasts, new Date().toISOString())).toEqual([]);
  });
  it('fails closed when the archive write fails', async () => {
    db.failed = true;
    expect(await archiveForecasts([cpi])).toEqual({ forecasts: new Map(), status: 'failed' });
  });
  it('fails closed and reports archive read failure without returning private details', async () => {
    db.readFailed = true;
    expect(await archiveForecasts([cpi])).toEqual({ forecasts: new Map(), status: 'failed' });
  });
});

afterEach(() => vi.useRealTimers());
