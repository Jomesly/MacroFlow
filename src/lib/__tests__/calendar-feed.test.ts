import { describe, expect, it } from 'vitest';
import { parseWeeklyFeed } from '../calendar/feed';

const row = (over: Record<string, unknown> = {}) => ({
  title: 'CPI m/m', country: 'USD', date: '2026-11-10T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.6%', ...over,
});

describe('weekly calendar feed', () => {
  it('maps the four impact levels', () => {
    const events = parseWeeklyFeed(['High', 'Medium', 'Low', 'Holiday'].map((impact, i) => row({ impact, title: `E${i}` })));
    expect(events.map(event => event.impact)).toEqual(['high', 'medium', 'low', 'holiday']);
  });
  it('converts times to UTC and empty values to null', () => {
    const [event] = parseWeeklyFeed([row({ forecast: '', previous: '' })]);
    expect(event).toMatchObject({ time: '2026-11-10T13:30:00.000Z', forecast: null, previous: null, actual: null, currency: 'USD' });
  });
  it('gives releases sharing a timestamp distinct ids', () => {
    const events = parseWeeklyFeed([row(), row({ title: 'Core CPI m/m' })]);
    expect(new Set(events.map(event => event.id)).size).toBe(2);
  });
  it('skips individual malformed rows and keeps the rest, sorted by time', () => {
    const events = parseWeeklyFeed([row({ date: 'not a date' }), row({ impact: 'Huge' }), null, row({ title: 'Late', date: '2026-11-11T08:30:00-05:00' }), row()]);
    expect(events.map(event => event.title)).toEqual(['CPI m/m', 'Late']);
  });
  it('lists the traded markets each currency affects', () => {
    const [usd, gbp, jpy] = parseWeeklyFeed([row(), row({ country: 'GBP', title: 'GDP m/m' }), row({ country: 'JPY', title: 'BOJ' })]);
    expect(usd.affects).toEqual(['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD']);
    expect(gbp.affects).toEqual(['GBPUSD']);
    expect(jpy.affects).toEqual([]);
  });
  it('rejects a payload that is not a list', () => {
    expect(() => parseWeeklyFeed({ error: 'rate limited' })).toThrow();
  });
});
