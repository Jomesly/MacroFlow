import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildMacroInputs, selectEventsAsOf, completedVintageDate, vintageAvailableAt } from '../macro-context';
import { fetchFredSnapshot } from '../api/fred-client';
import { scoreMacroAlignment } from '../alignment';
import { releaseToEvent } from '../api/calendar';
import { contextFixture, monthly } from './fixtures/macro';
import type { MacroEvent } from '../types';

const asOf = '2026-11-10T12:00:00.000Z';

describe('economic context', () => {
  it('recognizes cooling inflation even though the price index is still rising', () => {
    const { context, events } = buildMacroInputs(contextFixture(), asOf);
    expect(context.inflation).toBe('cooling');
    expect(events.find(event => event.seriesId === 'CPIAUCSL')?.value).toBe('cooling');
    expect(events.every(event => event.evidenceType === 'trend')).toBe(true);
    expect(events.some(event => ['beat', 'miss', 'high', 'low'].includes(event.value))).toBe(false);
  });
  it('recognizes slowing payroll gains and does not turn weak growth bullish just because cuts are priced', () => {
    const { context, events } = buildMacroInputs(contextFixture(), asOf);
    expect(events.find(event => event.seriesId === 'PAYEMS')?.value).toBe('weakening');
    expect(context.rateSpread).toBe(-1);
    expect(context.rateObservationDate).toBe('2026-11-06');
    expect(context.regime).toBe('growth_sensitive');
    const [result] = scoreMacroAlignment(events.filter(event => event.category === 'employment'), context, asOf, 'US100');
    expect(result.biasScore).toBeLessThan(0);
  });
  it('uses real GDP with a quarterly freshness policy', () => {
    const { context, events } = buildMacroInputs(contextFixture(), asOf);
    expect(context.complete).toBe(true);
    expect(context.growth).toBe('expanding');
    expect(events.find(event => event.category === 'gdp')?.seriesId).toBe('GDPC1');
  });
  it('uses the rate channel only when growth is resilient', () => {
    const fixture = contextFixture();
    fixture.series.UNRATE = monthly([4, 4, 4, 4]);
    const { context, events } = buildMacroInputs(fixture, asOf);
    expect(context.regime).toBe('rates_sensitive');
    const strong: MacroEvent = { ...events[0], id: 'jobs-surprise', evidenceType: 'surprise', category: 'employment', value: 'strong', timestamp: asOf };
    const [result] = scoreMacroAlignment([strong], context, asOf, 'US100');
    expect(result.biasScore).toBeLessThan(0);
  });
  it('treats a 0.2 pp unemployment rise as weakening despite floating-point subtraction', () => {
    const strong: MacroEvent = { id: 'jobs-surprise', category: 'employment', value: 'strong', country: 'US', evidenceType: 'surprise',
      timestamp: asOf, impact: 'high', title: 'US payrolls beat consensus', description: 'Boundary fixture' };
    const contextFor = (rates: number[]) => {
      const fixture = contextFixture();
      fixture.series.UNRATE = monthly(rates);
      return buildMacroInputs(fixture, asOf).context;
    };
    expect(4.6 - 4.4).toBeLessThan(0.2);
    const boundary = contextFor([4.6, 4.5, 4.5, 4.4]);
    expect(boundary).toMatchObject({ labor: 'weakening', regime: 'growth_sensitive' });
    expect(scoreMacroAlignment([strong], boundary, asOf, 'US100')[0].biasScore).toBe(10);
    expect(contextFor([4.5, 4.5, 4.4, 4.4])).toMatchObject({ labor: 'mixed', regime: 'rates_sensitive' });
    expect(contextFor([4.7, 4.6, 4.5, 4.4])).toMatchObject({ labor: 'weakening', regime: 'growth_sensitive' });
  });
  it('does not silently treat missing or stale context as a neutral regime', () => {
    const fixture = contextFixture();
    fixture.series.DFF = [{ date: '2026-10-01', value: '4.5' }];
    const { context, events } = buildMacroInputs(fixture, asOf);
    expect(context.regime).toBe('unknown');
    expect(context.rateSpread).toBeNull();
    const [result] = scoreMacroAlignment(events, context, asOf, 'US100');
    expect(result.alignment.status).toBe('insufficient_evidence');
    expect(result.signal).toBe('neutral');
  });
  it('rejects unavailable vintages and expires old snapshots', () => {
    expect(buildMacroInputs(contextFixture(), '2026-11-09T12:00:00Z').events).toHaveLength(0);
    expect(buildMacroInputs(contextFixture(), '2026-11-12T00:00:00Z').events).toHaveLength(0);
    expect(completedVintageDate(asOf)).toBe('2026-11-09');
    expect(vintageAvailableAt('2026-11-09')).toBe('2026-11-10T00:00:00.000Z');
  });
  it('rejects missing months instead of treating non-adjacent levels as a growth rate', () => {
    const fixture = contextFixture();
    fixture.series.CPIAUCSL!.splice(1, 1);
    expect(buildMacroInputs(fixture, asOf).context.inflation).toBe('unknown');
  });
  it('replaces older series observations and excludes future/expired news', () => {
    const base = buildMacroInputs(contextFixture(), asOf).events[0];
    const old = { ...base, id: 'old', timestamp: '2026-11-09T00:00:00Z' };
    const future = { ...base, id: 'future', timestamp: '2026-11-11T00:00:00Z' };
    const stale = { ...base, id: 'old-news', evidenceType: 'headline' as const, timestamp: '2026-11-08T00:00:00Z' };
    expect(selectEventsAsOf([old, base, future, stale], asOf).map(event => event.id)).toEqual([base.id]);
  });
});

describe('point-in-time FRED requests', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sets both vintage bounds and observation_end on every series request', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => { urls.push(url); return { ok: true, json: async () => ({ observations: [{ date: '2026-10-01', value: '100' }] }) }; }));
    const snapshot = await fetchFredSnapshot('2026-11-09', 'test-key');
    expect(snapshot.failedSeries).toEqual([]);
    expect(urls).toHaveLength(9);
    for (const url of urls) {
      expect(url.searchParams.get('realtime_start')).toBe('2026-11-09');
      expect(url.searchParams.get('realtime_end')).toBe('2026-11-09');
      expect(url.searchParams.get('observation_end')).toBe('2026-11-09');
    }
    expect(urls.some(url => url.searchParams.get('series_id') === 'DFF')).toBe(true);
    expect(urls.some(url => url.searchParams.get('series_id') === 'GDP')).toBe(false);
  });
});

describe('release surprises', () => {
  const release = { event: 'CPI', country: 'US', actual: 0.2, estimate: 0.3, impact: 'high', time: '2026-11-10 08:30:00' };
  it('requires consensus and respects release availability', () => {
    expect(releaseToEvent({ ...release, estimate: null }, asOf)).toBeNull();
    expect(releaseToEvent(release, '2026-11-10T08:00:00Z')).toBeNull();
    expect(releaseToEvent(release, asOf)).toMatchObject({ evidenceType: 'surprise', value: 'low', country: 'US' });
  });
});

describe('release classification through the shared scorer', () => {
  const growthContext = () => buildMacroInputs(contextFixture(), asOf).context;
  const score = (event: string, actual: number, estimate: number, country = 'US', symbol: 'US100' | 'GBPUSD' = 'US100') => {
    const released = releaseToEvent({ event, country, actual, estimate, impact: 'high', time: '2026-11-10 08:30:00' }, asOf);
    return { released, bias: released ? scoreMacroAlignment([released], growthContext(), asOf, symbol)[0].biasScore : null };
  };
  it('scores regional Fed surveys as activity data, not monetary policy', () => {
    for (const name of ['Philadelphia Fed Manufacturing Index', 'Richmond Fed Manufacturing Index', 'Kansas City Fed Manufacturing Index',
      'Dallas Fed Manufacturing Business Index', 'Richmond Fed Services Index', 'NY Empire State Manufacturing Index']) {
      const { released, bias } = score(name, 10, 5);
      expect(released, name).toMatchObject({ category: 'pmi', value: 'beat' });
      expect(bias, name).toBe(10);
    }
  });
  it('still scores policy-rate decisions as central-bank tone', () => {
    expect(score('Interest Rate Decision', 4.75, 4.5).released).toMatchObject({ category: 'fed_tone', value: 'hawkish' });
    expect(score('Fed Interest Rate Decision', 4.25, 4.5).released).toMatchObject({ category: 'fed_tone', value: 'dovish' });
    expect(score('BoE Interest Rate Decision', 4.75, 4.5, 'UK').released).toMatchObject({ category: 'boe_tone', value: 'hawkish', country: 'GB' });
  });
  it('rejects ambiguous Fed or central-bank releases instead of guessing a policy tone', () => {
    for (const name of ['Fed Balance Sheet', 'Atlanta Fed GDPNow', 'BoE MPC Vote Cut', 'Central Bank Reserves']) {
      expect(score(name, 10, 5).released, name).toBeNull();
    }
  });
});
