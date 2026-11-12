import { afterEach, expect, it, vi } from 'vitest';
import { fetchMarketData } from '../api/twelvedata';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';

vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => undefined) }));
vi.mock('../api/intraday', () => ({ fetchYahooHourly: vi.fn(async (instrument: string) => ({
  schemaVersion: 1, instrument, provider: 'Fixture', intervalMinutes: 60, fetchedAt: '2026-11-11T16:10:00Z',
  bars: [
    { openTime: '2026-11-10T15:00:00Z', closeTime: '2026-11-10T16:00:00Z', open: 100, high: 100, low: 100, close: 100 },
    { openTime: '2026-11-11T15:00:00Z', closeTime: '2026-11-11T16:00:00Z', open: 100, high: 101, low: 100, close: 101 },
  ],
})) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps a live equity rally out of the scored factors and shows it only as price context', async () => {
  const asOf = '2026-11-11T16:10:00.000Z';
  vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ chart: { result: [{
    meta: { regularMarketTime: Date.parse(asOf) / 1000 - 30, regularMarketPrice: 102.4, previousClose: 100 },
    timestamp: [Date.parse(asOf) / 1000 - 3600, Date.parse(asOf) / 1000 - 30],
    indicators: { quote: [{ close: [101.5, 102.4] }] },
  }] } }) })));
  const events = await fetchMarketData();
  for (const symbol of ['US100', 'US500', 'DJ30'] as const) {
    const [result] = scoreMarketForecast(events, unknownContext(asOf), asOf, symbol);
    expect(result.events.some(event => event.category === 'price_momentum'), `${symbol} scored its own price`).toBe(false);
    expect(result.forecast?.marketMove?.sessionChangePercent).toBeCloseTo(2.4);
  }
});
