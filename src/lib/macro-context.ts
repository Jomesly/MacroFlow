import type { EventCategory, MacroContext, MacroEvent } from './types';

export const MODEL_VERSION = 'macro-v4.2-asset-news-scoping-4h-2026-11-10';
export const DAY_MS = 86_400_000;
export const FRED_SERIES = ['CPIAUCSL', 'PAYEMS', 'UNRATE', 'GDPC1', 'RSXFS', 'DGS2', 'DFF', 'DGS10', 'DTWEXBGS'] as const;
export type FredSeriesId = typeof FRED_SERIES[number];
export interface FredObservation { date: string; value: string }
export interface FredSnapshot {
  schemaVersion: 1;
  vintageDate: string;
  /** A date-only vintage is usable starting the following UTC day. */
  availableAt: string;
  series: Partial<Record<FredSeriesId, FredObservation[]>>;
  failedSeries: FredSeriesId[];
}

export function completedVintageDate(asOf: string): string {
  return new Date(Date.parse(asOf.slice(0, 10) + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
}

export function vintageAvailableAt(date: string): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + DAY_MS).toISOString();
}

export function unknownContext(asOf: string, reason = 'Economic context unavailable'): MacroContext {
  return { asOf, regime: 'unknown', rateSpread: null, rateObservationDate: null, inflation: 'unknown', growth: 'unknown', labor: 'unknown', complete: false, reasons: [reason] };
}

function observations(snapshot: FredSnapshot, id: FredSeriesId, maxAgeDays: number, asOf: string) {
  const rows = (snapshot.series[id] ?? [])
    .filter(o => o.date <= snapshot.vintageDate && o.value.trim() !== '' && Number.isFinite(Number(o.value)))
    .map(o => ({ date: o.date, value: Number(o.value) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length || Date.parse(asOf) - Date.parse(rows[0].date) > maxAgeDays * DAY_MS) return [];
  return rows;
}

function monthsApart(newer: string, older: string): number {
  return (Number(newer.slice(0, 4)) - Number(older.slice(0, 4))) * 12 + Number(newer.slice(5, 7)) - Number(older.slice(5, 7));
}

function monthlySequence(rows: { date: string; value: number }[], count: number): boolean {
  return rows.length >= count && rows.slice(1, count).every((row, i) => monthsApart(rows[i].date, row.date) === 1);
}

export function buildMacroInputs(snapshot: FredSnapshot | null, asOf: string): { context: MacroContext; events: MacroEvent[] } {
  if (!snapshot || snapshot.schemaVersion !== 1 || Date.parse(snapshot.availableAt) > Date.parse(asOf)
    || snapshot.availableAt !== vintageAvailableAt(snapshot.vintageDate)
    || Date.parse(asOf) - Date.parse(snapshot.availableAt) >= 2 * DAY_MS) {
    return { context: unknownContext(asOf, 'Economic snapshot missing, stale, or not yet available'), events: [] };
  }
  const context = unknownContext(snapshot.availableAt);
  context.reasons = [];
  const events: MacroEvent[] = [];
  const addTrend = (seriesId: FredSeriesId, category: EventCategory, value: string, observationDate: string, title: string, detail: string) => {
    events.push({ id: `trend:${seriesId}:${snapshot.vintageDate}`, seriesId, category, value, observationDate,
      title, description: `${detail} Historical trend; no consensus surprise is inferred.`,
      timestamp: snapshot.availableAt, expiresAt: new Date(Date.parse(snapshot.availableAt) + 2 * DAY_MS).toISOString(),
      impact: ['CPIAUCSL', 'PAYEMS', 'GDPC1'].includes(seriesId) ? 'high' : 'medium',
      country: 'US', sourceName: 'FRED/ALFRED', evidenceType: 'trend', url: `https://fred.stlouisfed.org/series/${seriesId}` });
  };
  const cpi = observations(snapshot, 'CPIAUCSL', 75, asOf);
  if (monthlySequence(cpi, 7) && cpi.slice(0, 7).every(row => row.value > 0)) {
    const recent = (Math.pow(cpi[0].value / cpi[3].value, 4) - 1) * 100;
    const prior = (Math.pow(cpi[3].value / cpi[6].value, 4) - 1) * 100;
    context.inflation = recent - prior > 0.1 ? 'accelerating' : recent - prior < -0.1 ? 'cooling' : 'stable';
    addTrend('CPIAUCSL', 'inflation', context.inflation, cpi[0].date, `US inflation trend: ${context.inflation}`,
      `Three-month annualized CPI growth ${recent.toFixed(2)}%, prior three months ${prior.toFixed(2)}%.`);
  }
  const payrolls = observations(snapshot, 'PAYEMS', 75, asOf);
  const unemployment = observations(snapshot, 'UNRATE', 75, asOf);
  let jobsAverage: number | null = null;
  let unemploymentChange: number | null = null;
  if (monthlySequence(payrolls, 7)) {
    jobsAverage = (payrolls[0].value - payrolls[3].value) / 3;
    const prior = (payrolls[3].value - payrolls[6].value) / 3;
    const trend = jobsAverage - prior > 5 ? 'improving' : jobsAverage - prior < -5 ? 'weakening' : 'stable';
    addTrend('PAYEMS', 'employment', trend, payrolls[0].date, `US payroll growth: ${trend}`,
      `Average monthly job gains ${jobsAverage.toFixed(0)}k over three months, versus ${prior.toFixed(0)}k previously.`);
  }
  if (monthlySequence(unemployment, 4)) {
    // UNRATE is published to 0.1 pp; round so 4.6 - 4.4 compares as 0.2, not 0.1999...
    unemploymentChange = Math.round((unemployment[0].value - unemployment[3].value) * 100) / 100;
    const trend = unemploymentChange > 0.05 ? 'weakening' : unemploymentChange < -0.05 ? 'improving' : 'stable';
    addTrend('UNRATE', 'employment', trend, unemployment[0].date, `US unemployment trend: ${trend}`,
      `Unemployment changed ${unemploymentChange.toFixed(2)} percentage points over three months.`);
  }
  if (jobsAverage !== null && unemploymentChange !== null) {
    context.labor = jobsAverage <= 0 || unemploymentChange >= 0.2 ? 'weakening'
      : jobsAverage > 0 && unemploymentChange <= 0 ? 'improving' : 'mixed';
  }
  const gdp = observations(snapshot, 'GDPC1', 200, asOf);
  if (gdp.length >= 2 && monthsApart(gdp[0].date, gdp[1].date) === 3 && gdp[0].value > 0 && gdp[1].value > 0) {
    const growth = (Math.pow(gdp[0].value / gdp[1].value, 4) - 1) * 100;
    context.growth = growth >= 0 ? 'expanding' : 'contracting';
    addTrend('GDPC1', 'gdp', context.growth, gdp[0].date, `US real GDP: ${context.growth}`, `Real GDP quarterly annualized growth ${growth.toFixed(2)}%.`);
  }
  const retail = observations(snapshot, 'RSXFS', 75, asOf);
  if (monthlySequence(retail, 4) && retail[0].value > 0 && retail[3].value > 0) {
    const growth = (retail[0].value / retail[3].value - 1) * 100;
    addTrend('RSXFS', 'retail_sales', growth > 0 ? 'expanding' : growth < 0 ? 'contracting' : 'stable', retail[0].date,
      'US nominal retail sales trend', `Three-month nominal sales change ${growth.toFixed(2)}%; not inflation-adjusted.`);
  }
  const twoYear = observations(snapshot, 'DGS2', 7, asOf);
  const fedFunds = observations(snapshot, 'DFF', 7, asOf);
  const matchedRate = twoYear.find(row => fedFunds.some(fed => fed.date === row.date));
  if (matchedRate && Date.parse(asOf) - Date.parse(matchedRate.date) <= 7 * DAY_MS) {
    context.rateSpread = Math.round((matchedRate.value - fedFunds.find(fed => fed.date === matchedRate.date)!.value) * 100) / 100;
    context.rateObservationDate = matchedRate.date;
  }
  context.complete = context.inflation !== 'unknown' && context.labor !== 'unknown' && context.growth !== 'unknown' && context.rateSpread !== null;
  if (!context.complete) {
    context.regime = 'unknown';
    context.reasons.push('Fresh inflation, labor, real growth, and matched daily rate observations are required.');
  } else if (context.growth === 'contracting' || context.labor === 'weakening') {
    context.regime = 'growth_sensitive';
    context.reasons.push('Weakening labor or contracting real growth: weak activity is treated as a growth risk.');
  } else if (context.inflation === 'accelerating' || context.rateSpread! < -0.5) {
    context.regime = 'rates_sensitive';
    context.reasons.push('Resilient growth with inflation pressure or easing expectations: activity news is treated through the rate channel.');
  } else {
    context.regime = 'mixed';
    context.reasons.push('Rate and growth channels do not establish a clear regime.');
  }
  return { context, events };
}

/** One input-selection policy for production and replay. Trends are replaced, not accumulated. */
export function selectEventsAsOf(events: MacroEvent[], asOf: string): MacroEvent[] {
  const now = Date.parse(asOf);
  const latest = new Map<string, MacroEvent>();
  const selected: MacroEvent[] = [];
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time) || time > now) continue;
    const maxAge = event.evidenceType === 'trend' ? 2 * DAY_MS : event.evidenceType === 'market' ? 4 * 3_600_000 : DAY_MS;
    if (now - time >= maxAge || (event.expiresAt && (!Number.isFinite(Date.parse(event.expiresAt)) || Date.parse(event.expiresAt) <= now))) continue;
    if (event.evidenceType === 'trend' || event.evidenceType === 'market') {
      const key = `${event.evidenceType}:${event.seriesId ?? event.category}:${event.country ?? ''}`;
      const prior = latest.get(key);
      if (!prior || time > Date.parse(prior.timestamp) || (time === Date.parse(prior.timestamp) && event.id < prior.id)) latest.set(key, event);
    } else selected.push(event);
  }
  return [...selected, ...latest.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}
