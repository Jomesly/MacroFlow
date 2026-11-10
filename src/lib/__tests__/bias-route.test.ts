import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildMacroInputs } from '../macro-context';
import { contextFixture } from './fixtures/macro';
import { scoreMacroAlignment } from '../alignment';
import { maxBiasPoints } from '../engine';
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
    const body = await response.json();
    expect(body.data).toMatchObject(scoreMacroAlignment(inputs.events, inputs.context, asOf, 'US100'));
    expect(body.data[0].probability).toMatchObject({ status: 'unavailable', value: null });
    // Percentage = net news points / most points the market's news can add.
    expect(body.data[0].biasPercent).toBe(Math.round((100 * body.data[0].biasScore) / maxBiasPoints('US100')));
    expect(body.data[0].alignment.context.regime).toBe('growth_sensitive');
    expect(body.data[0].signal).toBe('neutral');
    expect(body.sourceHealth.economic_calendar).toBe('failed');
    const { getCalendar } = await import('../calendar');
    expect(getCalendar).not.toHaveBeenCalled();
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
  // 70 net points of Gold's 260 possible => 27%.
  it.each([['dovish', 'low', 'weak', 27, 'strong_buy'], ['hawkish', 'high', 'strong', -27, 'strong_sell']] as const)(
    'preserves the aligned %s macro signal without a fitted probability model', async (policy, inflation, dollar, expected, signal) => {
      const asOf = '2026-11-10T12:00:00.000Z';
      vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
      const { context } = buildMacroInputs(contextFixture(), asOf);
      const common = { title: 'Test evidence', description: 'Test evidence', country: 'US', impact: 'high' as const, timestamp: asOf };
      const events = [
        { ...common, id: 'fed', category: 'fed_tone' as const, value: policy, evidenceType: 'headline' as const },
        { ...common, id: 'cpi', category: 'inflation' as const, value: inflation, evidenceType: 'surprise' as const },
        { ...common, id: 'dxy', category: 'dollar_strength' as const, value: dollar, evidenceType: 'market' as const },
      ];
      const input = { events, context, source: 'live' as const, cachedAt: asOf, sourceHealth: { fred: 'ok' as const }, nextEvent: null };
      vi.mocked(getEvents).mockResolvedValue(input);
      const body = await (await GET(new NextRequest('http://localhost/api/bias?symbol=XAUUSD'))).json();
      expect(body.data[0]).toMatchObject({ biasPercent: expected, conviction: 'high', signal, alignment: { status: 'aligned' }, probability: { value: null } });
      vi.mocked(getEvents).mockResolvedValue({ ...input, stale: true });
      const stale = await (await GET(new NextRequest('http://localhost/api/bias?symbol=XAUUSD'))).json();
      expect(stale.data[0]).toMatchObject({ biasPercent: expected, signal: 'neutral' });
    });
});
