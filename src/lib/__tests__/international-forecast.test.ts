import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBiasSnapshot } from '../bias-snapshot';
import { getEvents } from '../events';
import { scoreMarketForecast } from '../forecast';
import { buildDomesticInputs, DOMESTIC_SERIES, unavailableDomesticHealth, type DomesticCountry, type DomesticSnapshot } from '../international-macro';
import { buildMacroInputs, vintageAvailableAt, type FredObservation, type FredSnapshot } from '../macro-context';
import type { AssetSymbol, EventCategory, MacroEvent, SourceHealth } from '../types';

vi.mock('../events', () => ({ getEvents: vi.fn() }));

const asOf = '2026-11-24T12:00:00.000Z';
const vintageDate = '2026-11-23';
const at = (hours: number) => new Date(Date.parse(asOf) + hours * 3_600_000).toISOString();
const pairs: { symbol: AssetSymbol; country: DomesticCountry; usdBase: 1 | -1; policy: EventCategory }[] = [
  { symbol: 'GBPUSD', country: 'GB', usdBase: -1, policy: 'boe_tone' },
  { symbol: 'EURUSD', country: 'EU', usdBase: -1, policy: 'ecb_tone' },
  { symbol: 'USDJPY', country: 'JP', usdBase: 1, policy: 'boj_tone' },
  { symbol: 'USDCHF', country: 'CH', usdBase: 1, policy: 'snb_tone' },
  { symbol: 'AUDUSD', country: 'AU', usdBase: -1, policy: 'rba_tone' },
  { symbol: 'USDCAD', country: 'CA', usdBase: 1, policy: 'boc_tone' },
  { symbol: 'NZDUSD', country: 'NZ', usdBase: -1, policy: 'rbnz_tone' },
];
type Pair = typeof pairs[number];
const cases = pairs.flatMap(pair => ([1, -1] as const).map(sign => ({ ...pair, sign })));
const monthly = (values: number[]): FredObservation[] => values.map((value, i) => ({
  date: new Date(Date.UTC(2026, 9 - i, 1)).toISOString().slice(0, 10), value: String(value),
}));
const quarterly = (values: number[]): FredObservation[] => values.map((value, i) => ({
  date: new Date(Date.UTC(2026, 6 - 3 * i, 1)).toISOString().slice(0, 10), value: String(value),
}));

/** Synthetic observations are transformed by the real US and domestic adapters. */
function usInputs(strength: number) {
  const strong = strength > 0;
  const snapshot: FredSnapshot = { schemaVersion: 1, vintageDate, availableAt: vintageAvailableAt(vintageDate), failedSeries: [], series: {
    CPIAUCSL: monthly(strong ? [118, 115, 112, 109, 108, 107, 106] : [109, 108, 107, 106, 103, 100, 97]),
    PAYEMS: monthly(strong ? [160600, 160400, 160200, 160000, 159900, 159800, 159700]
      : [160100, 160050, 160000, 159950, 159800, 159650, 159500]),
    UNRATE: monthly(strong ? [4, 4.1, 4.2, 4.3] : [4.6, 4.5, 4.4, 4.3]),
    GDPC1: quarterly(strong ? [23000, 22900] : [22800, 22900]),
    RSXFS: monthly(strong ? [700, 699, 698, 697] : [690, 691, 692, 693]),
    DGS2: [{ date: '2026-11-20', value: '3.5' }], DFF: [{ date: '2026-11-20', value: '4.5' }],
  } };
  return buildMacroInputs(snapshot, asOf);
}

function domesticSnapshot(country: DomesticCountry, strength: number): DomesticSnapshot {
  const series: DomesticSnapshot['series'] = {};
  for (const spec of DOMESTIC_SERIES[country]) {
    if (spec.transform === 'gdp_growth') series[spec.id] = quarterly([0.8 * strength, 0.4 * strength]);
    else if (spec.transform === 'gdp_level') series[spec.id] = quarterly([100 + strength, 100]);
    else if (spec.transform === 'unemployment') {
      const values = spec.frequency === 'quarterly' ? [4 - 0.3 * strength, 4] : [4 - 0.3 * strength, 4 - 0.2 * strength, 4 - 0.1 * strength, 4];
      series[spec.id] = spec.frequency === 'quarterly' ? quarterly(values) : monthly(values);
    } else {
      // An NSA index with accelerating/decelerating annual inflation, not a surprise.
      series[spec.id] = monthly(Array.from({ length: 16 }, (_, i) => {
        const t = 15 - i;
        return 100 * Math.exp(0.002 * t + strength * 0.0001 * t * t);
      }));
    }
  }
  return { schemaVersion: 1, country, vintageDate, availableAt: vintageAvailableAt(vintageDate),
    fetchedAt: at(-1), series, failedSeries: [] };
}

function newsAndMarkets(pair: Pair, sign: number): MacroEvent[] {
  const usdStrong = sign * pair.usdBase > 0;
  const domesticStrong = !usdStrong;
  const headline = (id: string, category: EventCategory, value: string, sourceName: string, country: string): MacroEvent => ({
    id, category, value, sourceName, country, title: id, description: `Synthetic ${id}`,
    timestamp: at(-1), url: `https://${sourceName.toLowerCase()}.example/${id}`, impact: 'high', evidenceType: 'headline',
  });
  const observation = (category: EventCategory, value: string): MacroEvent => ({
    id: `measured-${category}`, category, value, title: `Measured ${category}`, description: 'Synthetic measured observation',
    timestamp: at(-1), impact: 'medium', country: 'US', sourceName: 'Market data', evidenceType: 'market', seriesId: category,
  });
  return [
    { ...headline('direct-report', 'asset_sentiment', sign > 0 ? 'bullish' : 'bearish', 'Reuters', pair.country), symbol: pair.symbol },
    headline('domestic-policy', pair.policy, domesticStrong ? 'hawkish' : 'dovish', 'Bloomberg', pair.country),
    headline('us-policy', 'fed_tone', usdStrong ? 'hawkish' : 'dovish', 'Reuters', 'US'),
    observation('dollar_strength', usdStrong ? 'strong' : 'weak'),
    observation('yields', usdStrong ? 'rising' : 'falling'),
  ];
}

function readyInputs(pair: Pair, sign: number, snapshot: DomesticSnapshot | null = domesticSnapshot(pair.country, -sign * pair.usdBase)) {
  const us = usInputs(sign * pair.usdBase);
  const domestic = buildDomesticInputs(snapshot, pair.country, asOf);
  return {
    context: us.context, events: [...us.events, ...domestic.events, ...newsAndMarkets(pair, sign)],
    source: 'live' as const, cachedAt: asOf, nextEvent: null,
    sourceHealth: { finnhub: 'ok' as const, rss: 'ok' as const, market_data: 'ok' as const,
      fred: 'ok' as const, calendar_archive: 'ok' as const, economic_calendar: 'empty' as const,
      ...unavailableDomesticHealth(), [`domestic_${pair.country}`]: domestic.status } as SourceHealth,
    calendarEvidence: { fetchedAt: asOf, archiveStatus: 'ok' as const, archivedForecasts: [], events: [
      { id: 'later-schedule', title: 'Later release', currency: 'USD', time: at(5), impact: 'low' as const,
        forecast: null, previous: null, actual: null, affects: [pair.symbol] },
    ] },
  };
}

describe('domestic observations through the public FX forecast and grade', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(asOf)); });
  afterEach(() => vi.useRealTimers());

  it.each(cases)('$symbol direction $sign can earn High conviction with both economies and all seven checks', async pair => {
    const inputs = readyInputs(pair, pair.sign);
    expect(inputs.context.complete).toBe(true);
    expect(inputs.sourceHealth[`domestic_${pair.country}`]).toBe('ok');
    vi.mocked(getEvents).mockResolvedValue(inputs);
    const { results: [result], meta } = await buildBiasSnapshot(pair.symbol);
    expect(meta.inputsHealthy).toBe(true);
    expect(Math.sign(result.biasScore)).toBe(pair.sign);
    expect(Math.abs(result.biasScore)).toBeGreaterThanOrEqual(30);
    expect(result.forecast?.macroCoverage?.supportingCountries).toEqual(['US', pair.country]);
    expect(result.grade.checks.every(check => check.passed)).toBe(true);
    expect(result.grade.grade).toBe('A');
    expect(result.conviction).toBe('high');
    expect(result.signal).toBe(pair.sign > 0 ? 'strong_buy' : 'strong_sell');
    expect(result.events.filter(event => event.country === pair.country && event.evidenceType === 'trend')
      .every(event => event.trendEvidence?.vintageDate === vintageDate)).toBe(true);
  });

  it.each(cases)('$symbol direction $sign earns Medium when only supporting-source breadth is missing', async pair => {
    const inputs = readyInputs(pair, pair.sign);
    inputs.events = inputs.events.map(event => event.evidenceType === 'headline' ? { ...event, sourceName: 'Reuters' } : event);
    vi.mocked(getEvents).mockResolvedValue(inputs);
    const { results: [result] } = await buildBiasSnapshot(pair.symbol);
    expect(result.grade.checks.filter(check => !check.passed).map(check => check.id)).toEqual(['two_sources']);
    expect(result.grade.grade).toBe('B');
    expect(result.conviction).toBe('medium');
    expect(result.signal).toBe(pair.sign > 0 ? 'buy' : 'sell');
  });

  for (const issue of ['missing', 'stale', 'future', 'opposing', 'flat', 'provider_failed'] as const) {
    it.each(pairs)(`$symbol cannot turn ${issue} domestic evidence into a call`, async pair => {
      const strength = -pair.usdBase;
      let snapshot: DomesticSnapshot | null = domesticSnapshot(pair.country, issue === 'opposing' ? -strength : issue === 'flat' ? 0 : strength);
      if (issue === 'missing') snapshot = null;
      if (issue === 'stale' || issue === 'future') {
        const date = issue === 'stale' ? '2026-11-20' : '2026-11-25';
        snapshot = { ...snapshot!, vintageDate: date, availableAt: vintageAvailableAt(date) };
      }
      const inputs = readyInputs(pair, 1, snapshot);
      if (issue === 'provider_failed') inputs.sourceHealth[`domestic_${pair.country}`] = 'failed';
      vi.mocked(getEvents).mockResolvedValue(inputs);
      const { results: [result] } = await buildBiasSnapshot(pair.symbol);
      expect(result.biasScore).toBeGreaterThanOrEqual(30); // The news lean survives, but cannot qualify.
      expect(result.grade.grade).toBe('none');
      expect(result.conviction).toBe('low');
      expect(result.signal).toBe('neutral');
      expect(result.grade.checks.find(check => check.id === (issue === 'provider_failed' ? 'healthy_inputs' : 'macro_match'))?.passed).toBe(false);
    });
  }

  it('keeps US-only markets identical when valid foreign snapshots are added', () => {
    const us = usInputs(1);
    const observations = newsAndMarkets(pairs[0], -1);
    const foreign = pairs.flatMap(pair => buildDomesticInputs(domesticSnapshot(pair.country, 1), pair.country, asOf).events);
    for (const symbol of ['XAUUSD', 'US100', 'US500', 'DJ30', 'BTCUSD'] as const) {
      expect(scoreMarketForecast([...us.events, ...observations, ...foreign], us.context, asOf, symbol))
        .toEqual(scoreMarketForecast([...us.events, ...observations], us.context, asOf, symbol));
    }
  });
});
