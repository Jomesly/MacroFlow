import { DAY_MS, vintageAvailableAt, type FredObservation } from './macro-context';
import { COUNTRY_NAMES } from './macro-coverage';
import type { MacroEvent, SourceHealth, SourceStatus } from './types';

export const DOMESTIC_COUNTRIES = ['GB', 'EU', 'JP', 'CH', 'AU', 'CA', 'NZ'] as const;
export type DomesticCountry = typeof DOMESTIC_COUNTRIES[number];
type Transform = 'gdp_growth' | 'gdp_level' | 'unemployment' | 'hicp';
export interface DomesticSeries {
  id: string;
  transform: Transform;
  frequency: 'monthly' | 'quarterly';
  units: string;
  maxAgeDays: number;
}

const gdp = (id: string): DomesticSeries => ({ id, transform: 'gdp_growth', frequency: 'quarterly',
  units: 'percent change from previous quarter, seasonally adjusted', maxAgeDays: 180 });
const labor = (id: string, quarterly = false): DomesticSeries => ({ id, transform: 'unemployment',
  frequency: quarterly ? 'quarterly' : 'monthly', units: 'percent of labor force, seasonally adjusted', maxAgeDays: 150 });
const hicp = (id: string): DomesticSeries => ({ id, transform: 'hicp', frequency: 'monthly',
  units: 'index 2025=100, not seasonally adjusted', maxAgeDays: 90 });

/** Explicitly vetted series; discontinued OECD CPI series must not be substituted. */
export const DOMESTIC_SERIES: Readonly<Record<DomesticCountry, readonly DomesticSeries[]>> = {
  GB: [gdp('NAEXKP01GBQ657S'), labor('LRHUTTTTGBM156S')],
  EU: [{ id: 'CLV10MNACB1GQSCAEA20Q', transform: 'gdp_level', frequency: 'quarterly',
    units: 'millions of chained 2010 euro, seasonally and calendar adjusted', maxAgeDays: 180 }, hicp('CP0000EZCCM086NEST')],
  JP: [gdp('NAEXKP01JPQ657S'), labor('LRHUTTTTJPM156S')],
  CH: [gdp('NAEXKP01CHQ657S'), hicp('CP0000CHM086NEST')],
  AU: [gdp('NAEXKP01AUQ657S'), labor('LRHUTTTTAUM156S')],
  CA: [gdp('NAEXKP01CAQ657S'), labor('LRHUTTTTCAM156S')],
  NZ: [gdp('NAEXKP01NZQ657S'), labor('LRHUTTTTNZQ156S', true)],
};

export interface DomesticSnapshot {
  schemaVersion: 1;
  country: DomesticCountry;
  vintageDate: string;
  availableAt: string;
  fetchedAt: string;
  series: Record<string, FredObservation[]>;
  failedSeries: string[];
}

export interface TrendEvidence {
  provider: 'FRED/ALFRED';
  seriesId: string;
  units: string;
  frequency: 'monthly' | 'quarterly';
  vintageDate: string;
  availableAt: string;
  fetchedAt: string;
  observationEnd: string;
  currentValue: number;
  comparisonValue: number;
  derivedValue: number;
  derivedUnits: 'percent change from previous quarter' | 'percentage point change over one quarter' | 'annual percent change';
  /** A historical transform, never a consensus surprise. */
  transform: Transform;
}

const monthsApart = (newer: string, older: string) =>
  (Number(newer.slice(0, 4)) - Number(older.slice(0, 4))) * 12 + Number(newer.slice(5, 7)) - Number(older.slice(5, 7));
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** End of the observed month/quarter, not the first-day period label used by FRED. */
export function observationPeriodEnd(date: string, frequency: DomesticSeries['frequency']): string | null {
  if (!validDate(date) || !date.endsWith('-01')) return null;
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)) - 1;
  if (frequency === 'quarterly' && month % 3 !== 0) return null;
  return new Date(Date.UTC(year, month + (frequency === 'quarterly' ? 3 : 1), 1) - 1).toISOString();
}

function readings(snapshot: DomesticSnapshot, spec: DomesticSeries, asOf: string) {
  const dates = new Set<string>();
  const rows = (snapshot.series[spec.id] ?? []).flatMap(row => {
    const end = observationPeriodEnd(row.date, spec.frequency);
    // A missing FRED value ('.') is not zero. Incomplete periods cannot be known yet.
    if (!end || row.date > snapshot.vintageDate || Date.parse(end) >= Date.parse(snapshot.availableAt)
      || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(row.value.trim())) return [];
    const value = Number(row.value);
    if (!Number.isFinite(value) || dates.has(row.date)) return [];
    dates.add(row.date);
    return [{ date: row.date, value, end }];
  }).sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length || Date.parse(asOf) - Date.parse(rows[0].end) >= spec.maxAgeDays * DAY_MS) return [];
  const step = spec.frequency === 'quarterly' ? 3 : 1;
  const count = spec.transform === 'hicp' ? 16 : spec.transform === 'unemployment' && step === 1 ? 4 : 2;
  if (rows.length < count || rows.slice(1, count).some((row, i) => monthsApart(rows[i].date, row.date) !== step)) return [];
  return rows;
}

function transform(rows: ReturnType<typeof readings>, spec: DomesticSeries) {
  const latest = rows[0];
  if (!latest) return null;
  if (spec.transform === 'unemployment') {
    if (rows.some(row => row.value < 0 || row.value > 100)) return null;
    const prior = rows[spec.frequency === 'quarterly' ? 1 : 3];
    const change = Math.round((latest.value - prior.value) * 1000) / 1000;
    return { category: 'employment' as const, value: change > 0.05 ? 'weakening' : change < -0.05 ? 'improving' : 'stable',
      current: latest.value, previous: prior.value, derived: change,
      derivedUnits: 'percentage point change over one quarter' as const,
      summary: `Unemployment changed ${change.toFixed(2)} percentage points over one quarter.` };
  }
  if (spec.transform === 'hicp') {
    if (rows.slice(0, 16).some(row => row.value <= 0)) return null;
    // Compare annual inflation with annual inflation three months earlier: NSA index levels
    // must not be compared as if they were seasonally adjusted monthly growth.
    const current = (latest.value / rows[12].value - 1) * 100;
    const previous = (rows[3].value / rows[15].value - 1) * 100;
    const change = Math.round((current - previous) * 1000) / 1000;
    return { category: 'inflation' as const, value: change > 0.1 ? 'accelerating' : change < -0.1 ? 'cooling' : 'stable',
      current: latest.value, previous: rows[12].value, derived: current, derivedUnits: 'annual percent change' as const,
      summary: `Annual HICP inflation ${current.toFixed(2)}%, versus ${previous.toFixed(2)}% three months earlier.` };
  }
  if (spec.transform === 'gdp_level' && rows.slice(0, 2).some(row => row.value <= 0)) return null;
  const current = spec.transform === 'gdp_level' ? (latest.value / rows[1].value - 1) * 100 : latest.value;
  return { category: 'gdp' as const, value: current > 0 ? 'expanding' : current < 0 ? 'contracting' : 'stable',
    current: latest.value, previous: rows[1].value, derived: current, derivedUnits: 'percent change from previous quarter' as const,
    summary: `Real GDP changed ${current.toFixed(2)}% from the previous quarter; seasonally adjusted, not annualized.` };
}

/** Build a bounded, point-in-time trend snapshot. Fetching does not change its ALFRED vintage. */
export function buildDomesticInputs(snapshot: DomesticSnapshot | null, country: DomesticCountry, asOf: string): { events: MacroEvent[]; status: SourceStatus } {
  const now = Date.parse(asOf);
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.country !== country || !validDate(snapshot.vintageDate)
    || !Number.isFinite(now) || !Number.isFinite(Date.parse(snapshot.fetchedAt))
    || snapshot.availableAt !== vintageAvailableAt(snapshot.vintageDate)
    || Date.parse(snapshot.availableAt) > now || now - Date.parse(snapshot.availableAt) >= 2 * DAY_MS) {
    return { events: [], status: 'empty' };
  }
  const events: MacroEvent[] = [];
  let usable = 0;
  for (const spec of DOMESTIC_SERIES[country]) {
    if (snapshot.failedSeries.includes(spec.id)) continue;
    const rows = readings(snapshot, spec, asOf);
    const result = transform(rows, spec);
    if (!result) continue;
    usable++;
    // A neutral observation is healthy data, but supplies no directional support.
    if (result.value === 'stable') continue;
    events.push({ id: `domestic:${country}:${spec.id}:${snapshot.vintageDate}`, country,
      seriesId: spec.id, category: result.category, value: result.value, impact: 'high', evidenceType: 'trend',
      title: `${COUNTRY_NAMES[country]} ${result.category === 'employment' ? 'labor' : result.category} trend: ${result.value}`,
      description: `${result.summary} Observation period starts ${rows[0].date}; ALFRED vintage ${snapshot.vintageDate}. Historical trend; no consensus surprise is inferred.`,
      timestamp: snapshot.availableAt, observationDate: rows[0].date,
      expiresAt: new Date(Math.min(Date.parse(snapshot.availableAt) + 2 * DAY_MS,
        Date.parse(rows[0].end) + spec.maxAgeDays * DAY_MS)).toISOString(),
      sourceName: 'FRED/ALFRED', url: `https://fred.stlouisfed.org/series/${spec.id}`,
      trendEvidence: { provider: 'FRED/ALFRED', seriesId: spec.id, units: spec.units, frequency: spec.frequency,
        vintageDate: snapshot.vintageDate, availableAt: snapshot.availableAt, fetchedAt: snapshot.fetchedAt,
        observationEnd: rows[0].end, currentValue: result.current, comparisonValue: result.previous,
        derivedValue: result.derived, derivedUnits: result.derivedUnits, transform: spec.transform },
    });
  }
  return { events, status: snapshot.failedSeries.length ? 'failed' : usable === DOMESTIC_SERIES[country].length ? 'ok' : 'empty' };
}

export function unavailableDomesticHealth(status: SourceStatus = 'failed'): SourceHealth {
  return Object.fromEntries(DOMESTIC_COUNTRIES.map(country => [`domestic_${country}`, status]));
}
