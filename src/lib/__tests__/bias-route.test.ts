import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildMacroInputs, unknownContext } from '../macro-context';
import { contextFixture } from './fixtures/macro';
import { FORECAST_VERSION, scoreMarketForecast } from '../forecast';
import { classifyHeadline, createEventFromClassification } from '../api/classifier';
import { getHistory, recordDailySnapshot } from '../redis';
import { getEvents } from '../events';
import { GET } from '../../app/api/bias/route';

vi.mock('../events', () => ({ getEvents: vi.fn() }));
vi.mock('../redis', () => ({ getHistory: vi.fn(async () => []), recordDailySnapshot: vi.fn(async () => undefined) }));
vi.mock('../calendar', async (importOriginal) => ({ ...(await importOriginal<typeof import('../calendar')>()),
  getCalendar: vi.fn(async () => { throw new Error('Calendar feed HTTP 503'); }) }));

describe('live bias route', () => {
  afterEach(() => vi.useRealTimers());
  it('passes the available regime to the shared scorer and preserves source failures', async () => {
    const asOf = '2026-11-10T12:00:00.000Z';
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    const inputs = buildMacroInputs(contextFixture(), asOf);
    vi.mocked(getEvents).mockResolvedValue({ ...inputs, source: 'live', cachedAt: asOf, sourceHealth: { economic_calendar: 'failed', fred: 'ok' }, nextEvent: null });
    const response = await GET(new NextRequest('http://localhost/api/bias?symbol=US100'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.data).toMatchObject(JSON.parse(JSON.stringify(scoreMarketForecast(inputs.events, inputs.context, asOf, 'US100'))));
    expect(body.data[0].alignment.context.regime).toBe('growth_sensitive');
    expect(body.data[0].signal).toBe('neutral');
    expect(body.sourceHealth.economic_calendar).toBe('failed');
    const { getCalendar } = await import('../calendar');
    expect(getCalendar).not.toHaveBeenCalled();
  });
  it('returns a USD/JPY news forecast through the live endpoint when macro data is missing', async () => {
    const asOf = '2026-11-11T12:00:00.000Z';
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    const events = classifyHeadline('USD/JPY rallies as the yen weakens').map(row =>
      createEventFromClassification(row, 'FX news', 'https://example.com/usdjpy', asOf));
    vi.mocked(getEvents).mockResolvedValue({ events, context: unknownContext(asOf), source: 'live', cachedAt: asOf,
      sourceHealth: { rss: 'ok', fred: 'failed', market_data: 'empty' }, nextEvent: null });
    const body = await (await GET(new NextRequest('http://localhost/api/bias?symbol=USDJPY'))).json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ symbol: 'USDJPY', direction: 'weakly_bullish', conviction: 'low',
      forecast: { basis: 'news', modelVersion: FORECAST_VERSION }, signal: 'neutral' });
    expect(body.sourceHealth.fred).toBe('failed');
    expect(recordDailySnapshot).toHaveBeenCalledWith('USDJPY', 'weakly_bullish', body.data[0].biasScore, FORECAST_VERSION);
    expect(getHistory).toHaveBeenCalledWith('USDJPY', FORECAST_VERSION);
  });
  it('uses the already-fetched upcoming event and hides it once its scheduled time passes', async () => {
    const asOf = '2026-11-10T12:00:00.000Z';
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    const inputs = buildMacroInputs(contextFixture(), asOf);
    const nextEvent = { name: 'CPI', country: 'USD', date: '2026-11-10T13:00:00Z', impact: 'high' as const, affects: ['XAUUSD'] };
    vi.mocked(getEvents).mockResolvedValue({ ...inputs, source: 'live', cachedAt: asOf, sourceHealth: { economic_calendar: 'empty', calendar_archive: 'ok' }, nextEvent });
    expect((await (await GET(new NextRequest('http://localhost/api/bias'))).json()).nextEvent).toEqual(nextEvent);
    vi.setSystemTime(new Date(nextEvent.date));
    expect((await (await GET(new NextRequest('http://localhost/api/bias'))).json()).nextEvent).toBeNull();
  });
  it.each([
    ['GBPUSD', 'Cable rallies', 'weakly_bullish'],
    ['XAUUSD', 'Gold falls', 'weakly_bearish'],
    ['BTCUSD', 'BTC rallies', 'weakly_bullish'],
    ['US100', 'NAS100 falls', 'weakly_bearish'],
    ['DJ30', 'US30 rallies', 'weakly_bullish'],
  ])('serves an asset-specific %s forecast from the dashboard endpoint', async (symbol, headline, direction) => {
    const asOf = '2026-11-11T12:00:00.000Z';
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    const events = classifyHeadline(headline).map(row => createEventFromClassification(row, 'News', 'https://example.com/story', asOf));
    vi.mocked(getEvents).mockResolvedValue({ events, context: unknownContext(asOf), source: 'live', cachedAt: asOf,
      sourceHealth: { rss: 'ok', fred: 'failed' }, nextEvent: null });
    const body = await (await GET(new NextRequest(`http://localhost/api/bias?symbol=${symbol}`))).json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ symbol, direction, conviction: 'low', forecast: { basis: 'news' } });
  });
});
