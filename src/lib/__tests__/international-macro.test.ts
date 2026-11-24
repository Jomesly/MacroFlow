import { describe, expect, it } from 'vitest';
import { buildDomesticInputs, DOMESTIC_COUNTRIES, DOMESTIC_SERIES, observationPeriodEnd,
  type DomesticCountry, type DomesticSnapshot } from '../international-macro';
import { selectEventsAsOf } from '../macro-context';

const asOf = '2026-11-24T10:00:00.000Z';
function fixture(country: DomesticCountry): DomesticSnapshot {
  const snapshot: DomesticSnapshot = { schemaVersion: 1, country, vintageDate: '2026-11-23',
    availableAt: '2026-11-24T00:00:00.000Z', fetchedAt: asOf, series: {}, failedSeries: [] };
  for (const spec of DOMESTIC_SERIES[country]) {
    const quarterly = spec.frequency === 'quarterly';
    snapshot.series[spec.id] = Array.from({ length: 20 }, (_, i) => ({
      date: new Date(Date.UTC(2026, (quarterly ? 6 : 9) - i * (quarterly ? 3 : 1), 1)).toISOString().slice(0, 10),
      value: String(spec.transform === 'gdp_growth' ? 0.4 : spec.transform === 'gdp_level' ? 1000 - i * 5
        : spec.transform === 'unemployment' ? 4 + i * 0.1 : 110 - i * 0.4 - i * i * 0.01),
    }));
  }
  return snapshot;
}

describe('verified domestic trend snapshots', () => {
  it.each(DOMESTIC_COUNTRIES)('builds country-specific trends with provenance for %s', country => {
    const result = buildDomesticInputs(fixture(country), country, asOf);
    expect(result.status).toBe('ok');
    expect(result.events).toHaveLength(2);
    for (const event of result.events) {
      expect(event).toMatchObject({ country, evidenceType: 'trend', timestamp: '2026-11-24T00:00:00.000Z',
        sourceName: 'FRED/ALFRED', trendEvidence: { vintageDate: '2026-11-23', fetchedAt: asOf } });
      expect(event.releaseEvidence).toBeUndefined();
      expect(event.description).toContain('no consensus surprise');
      expect(event.url).toBe(`https://fred.stlouisfed.org/series/${event.seriesId}`);
    }
  });

  it('uses the supplied GDP percent change without changing it a second time', () => {
    const snapshot = fixture('GB');
    snapshot.series.NAEXKP01GBQ657S[0].value = '-0.03';
    const event = buildDomesticInputs(snapshot, 'GB', asOf).events.find(row => row.category === 'gdp');
    expect(event).toMatchObject({ value: 'contracting', trendEvidence: { currentValue: -0.03, derivedValue: -0.03,
      derivedUnits: 'percent change from previous quarter' } });
  });

  it('transforms euro-area real GDP levels into quarterly growth', () => {
    const snapshot = fixture('EU');
    snapshot.series.CLV10MNACB1GQSCAEA20Q[0].value = '2951900.6';
    snapshot.series.CLV10MNACB1GQSCAEA20Q[1].value = '2939830.6';
    const event = buildDomesticInputs(snapshot, 'EU', asOf).events.find(row => row.category === 'gdp');
    expect(event?.trendEvidence?.derivedValue).toBeCloseTo(0.41057, 4);
    expect(event?.trendEvidence?.currentValue).toBe(2951900.6);
    expect(event?.value).toBe('expanding');
  });

  it('compares unemployment rates over a quarter, including NZ quarterly data', () => {
    for (const country of ['GB', 'NZ'] as const) {
      const result = buildDomesticInputs(fixture(country), country, asOf);
      const event = result.events.find(row => row.category === 'employment');
      expect(event?.value).toBe('improving');
      expect(event?.trendEvidence?.derivedValue).toBeCloseTo(country === 'GB' ? -0.3 : -0.1);
    }
  });

  it('compares annual HICP inflation to three months earlier, preserving raw index units', () => {
    const snapshot = fixture('CH'), rows = snapshot.series.CP0000CHM086NEST;
    const result = buildDomesticInputs(snapshot, 'CH', asOf).events.find(row => row.category === 'inflation');
    expect(result?.trendEvidence?.derivedValue).toBeCloseTo((Number(rows[0].value) / Number(rows[12].value) - 1) * 100);
    expect(result?.trendEvidence?.currentValue).toBe(Number(rows[0].value));
    expect(result?.trendEvidence?.derivedUnits).toBe('annual percent change');
  });

  it('recognizes unchanged data as healthy without manufacturing directional evidence', () => {
    const snapshot = fixture('GB');
    snapshot.series.NAEXKP01GBQ657S.forEach(row => { row.value = '0'; });
    snapshot.series.LRHUTTTTGBM156S.forEach(row => { row.value = '4'; });
    expect(buildDomesticInputs(snapshot, 'GB', asOf)).toEqual({ status: 'ok', events: [] });
  });

  it('bounds quarterly observation age from period end rather than period start', () => {
    const snapshot = fixture('AU');
    snapshot.series.NAEXKP01AUQ657S.shift(); // Q2 starts April and ends June.
    expect(buildDomesticInputs(snapshot, 'AU', asOf).status).toBe('ok');
    expect(observationPeriodEnd('2026-04-01', 'quarterly')).toBe('2026-06-30T23:59:59.999Z');
  });

  it.each(['stale', 'future', 'wrong_country', 'invalid_date', 'wrong_availability', 'invalid_fetch'] as const)(
    'rejects a %s snapshot', kind => {
      const snapshot = fixture('GB');
      if (kind === 'stale') { snapshot.vintageDate = '2026-11-20'; snapshot.availableAt = '2026-11-21T00:00:00.000Z'; }
      if (kind === 'future') { snapshot.vintageDate = '2026-11-24'; snapshot.availableAt = '2026-11-25T00:00:00.000Z'; }
      if (kind === 'wrong_country') snapshot.country = 'JP';
      if (kind === 'invalid_date') snapshot.vintageDate = '2026-02-30';
      if (kind === 'wrong_availability') snapshot.availableAt = asOf;
      if (kind === 'invalid_fetch') snapshot.fetchedAt = 'bad';
      expect(buildDomesticInputs(snapshot, 'GB', asOf)).toEqual({ events: [], status: 'empty' });
    },
  );

  it.each(['old_period', 'gap', 'missing', 'invalid', 'negative_rate'] as const)('does not claim complete labor coverage with %s values', kind => {
    const snapshot = fixture('GB'), rows = snapshot.series.LRHUTTTTGBM156S;
    if (kind === 'old_period') rows.forEach(row => { row.date = row.date.replace('2026', '2025'); });
    if (kind === 'gap') rows.splice(1, 1);
    if (kind === 'missing') rows.forEach(row => { row.value = '.'; });
    if (kind === 'invalid') rows.forEach(row => { row.value = ''; });
    if (kind === 'negative_rate') rows[0].value = '-2';
    const result = buildDomesticInputs(snapshot, 'GB', asOf);
    expect(result.status).toBe('empty');
    expect(result.events.some(row => row.category === 'employment')).toBe(false);
  });

  it('retains a partial source failure without pretending the country is healthy', () => {
    const snapshot = fixture('JP');
    snapshot.failedSeries.push('LRHUTTTTJPM156S');
    const result = buildDomesticInputs(snapshot, 'JP', asOf);
    expect(result.status).toBe('failed');
    expect(result.events).toHaveLength(1);
  });

  it('retains the original vintage timestamp across refresh and expires it in the normal selector', () => {
    const snapshot = fixture('CA');
    const before = buildDomesticInputs(snapshot, 'CA', asOf).events;
    const later = buildDomesticInputs({ ...snapshot, fetchedAt: '2026-11-24T15:00:00.000Z' }, 'CA', asOf).events;
    expect(later.map(row => row.timestamp)).toEqual(before.map(row => row.timestamp));
    expect(selectEventsAsOf(later, '2026-11-26T00:00:00.000Z')).toEqual([]);
  });
});
