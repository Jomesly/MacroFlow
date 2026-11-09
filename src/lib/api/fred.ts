import { MacroEvent } from '../types';
import { getCached, setCache } from './cache';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred';
const CACHE_KEY = 'fred_events';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

// FRED dates a reading by the start of its period, weeks before it is published.
export const FRED_MAX_AGE_DAYS = { monthly: 75, quarterly: 200 };

const RATE_SPREAD_CACHE_KEY = 'fred_rate_spread';
const RATE_SPREAD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const OBSERVATION_LIMIT = 14;
const CPI_ACCELERATION_MARGIN_PP = 0.05;
const PAYROLL_PACE_MARGIN_THOUSANDS = 25;
const GDP_PACE_MARGIN_PP = 0.25;
const RETAIL_PACE_MARGIN_PP = 0.1;
const RECENT_PACE_MONTHS = 6;

interface FredObservation {
  date: string;
  value: string;
}

interface FredSeriesResponse {
  observations: FredObservation[];
  realtime_start: string;
  realtime_end: string;
}

type FredKey = 'CPI' | 'UNEMPLOYMENT' | 'NFP' | 'GDP' | 'RETAIL_SALES';

const FRED_SERIES = [
  {
    key: 'CPI',
    seriesId: 'CPIAUCSL',
    category: 'inflation' as const,
    title: 'US Consumer Price Index',
    impact: 'high' as const,
    maxAgeDays: FRED_MAX_AGE_DAYS.monthly,
  },
  {
    key: 'UNEMPLOYMENT',
    seriesId: 'UNRATE',
    category: 'employment' as const,
    title: 'US Unemployment Rate',
    impact: 'medium' as const,
    maxAgeDays: FRED_MAX_AGE_DAYS.monthly,
  },
  {
    key: 'NFP',
    seriesId: 'PAYEMS',
    category: 'employment' as const,
    title: 'US Nonfarm Payrolls',
    impact: 'high' as const,
    maxAgeDays: FRED_MAX_AGE_DAYS.monthly,
  },
  {
    key: 'GDP',
    seriesId: 'GDPC1',
    category: 'gdp' as const,
    title: 'US Real GDP',
    impact: 'high' as const,
    maxAgeDays: FRED_MAX_AGE_DAYS.quarterly,
  },
  {
    key: 'RETAIL_SALES',
    seriesId: 'RSXFS',
    category: 'retail_sales' as const,
    title: 'US Retail Sales',
    impact: 'medium' as const,
    maxAgeDays: FRED_MAX_AGE_DAYS.monthly,
  },
] satisfies { key: FredKey; seriesId: string; category: MacroEvent['category']; title: string; impact: MacroEvent['impact']; maxAgeDays: number }[];

function isStale(dateStr: string, maxAgeDays: number): boolean {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24) > maxAgeDays;
}

async function fetchFredSeries(seriesId: string, apiKey: string): Promise<FredObservation[]> {
  const url = new URL(`${FRED_BASE_URL}/series/observations`);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', String(OBSERVATION_LIMIT));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`FRED API error: ${response.status} ${response.statusText}`);
  }
  const data: FredSeriesResponse = await response.json();
  // FRED reports missing days (holidays, shutdowns) as "."
  return data.observations.filter((observation) => Number.isFinite(parseFloat(observation.value)));
}

const fixed = (value: number, digits = 2) => value.toFixed(digits);
const percentChange = (latest: number, base: number) => (latest / base - 1) * 100;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function byPace(latest: number, pace: number, margin: number, above: string, below: string): string {
  if (latest > pace + margin) return above;
  if (latest < pace - margin) return below;
  return 'neutral';
}

/**
 * Reads macro momentum from a series, newest observation first. These series
 * are levels that rise almost every period, so the level alone says nothing.
 * Without consensus forecasts this measures momentum, not a data surprise.
 */
export function classifyFredObservations(key: FredKey, observations: FredObservation[]): { value: string; description: string } | null {
  const values = observations.map((observation) => parseFloat(observation.value));

  if (key === 'CPI') {
    if (values.length < 14) return null;
    const latest = percentChange(values[0], values[12]);
    const previous = percentChange(values[1], values[13]);
    return {
      value: byPace(latest, previous, CPI_ACCELERATION_MARGIN_PP, 'high', 'low'),
      description: `US CPI inflation was ${fixed(latest)}% year on year, from ${fixed(previous)}% the month before.`,
    };
  }

  if (key === 'UNEMPLOYMENT') {
    if (values.length < 2) return null;
    const change = Math.round((values[0] - values[1]) * 10) / 10;
    return {
      value: change > 0 ? 'weak' : change < 0 ? 'strong' : 'neutral',
      description: `US unemployment was ${values[0]}%, from ${values[1]}% the month before.`,
    };
  }

  if (key === 'NFP') {
    if (values.length < RECENT_PACE_MONTHS + 2) return null;
    const changes = values.slice(0, -1).map((value, index) => value - values[index + 1]);
    const pace = average(changes.slice(1, RECENT_PACE_MONTHS + 1));
    return {
      value: changes[0] < 0 ? 'weak' : byPace(changes[0], pace, PAYROLL_PACE_MARGIN_THOUSANDS, 'strong', 'weak'),
      description: `US payrolls changed by ${fixed(changes[0], 0)}k, against a recent average of ${fixed(pace, 0)}k a month.`,
    };
  }

  if (key === 'GDP') {
    if (values.length < 3) return null;
    const annualized = (latest: number, base: number) => (Math.pow(latest / base, 4) - 1) * 100;
    const latest = annualized(values[0], values[1]);
    const previous = annualized(values[1], values[2]);
    return {
      value: latest < 0 ? 'miss' : byPace(latest, previous, GDP_PACE_MARGIN_PP, 'beat', 'miss'),
      description: `US real GDP grew at a ${fixed(latest, 1)}% annualized pace, from ${fixed(previous, 1)}% the quarter before.`,
    };
  }

  if (values.length < RECENT_PACE_MONTHS + 2) return null;
  const changes = values.slice(0, -1).map((value, index) => percentChange(value, values[index + 1]));
  const pace = average(changes.slice(1, RECENT_PACE_MONTHS + 1));
  return {
    value: byPace(changes[0], pace, RETAIL_PACE_MARGIN_PP, 'beat', 'miss'),
    description: `US retail sales changed ${fixed(changes[0])}% on the month, against a recent average of ${fixed(pace)}%.`,
  };
}

function mapToMacroEvent(series: typeof FRED_SERIES[number], observations: FredObservation[]): MacroEvent | null {
  const reading = classifyFredObservations(series.key, observations);
  if (!reading) return null;
  const latest = observations[0];

  return {
    id: `fred_${series.key}_${latest.date}`,
    category: series.category,
    title: series.title,
    description: reading.description,
    timestamp: new Date(latest.date).toISOString(),
    impact: series.impact,
    value: reading.value,
    country: 'US',
    url: `https://fred.stlouisfed.org/series/${series.seriesId}`,
    sourceName: 'FRED',
  };
}

export async function fetchFredEvents(): Promise<MacroEvent[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.warn('[FRED] No API key configured, skipping FRED data fetch');
    return [];
  }

  const cached = await getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  const events: MacroEvent[] = [];

  for (const series of FRED_SERIES) {
    try {
      const observations = await fetchFredSeries(series.seriesId, apiKey);
      if (observations.length === 0 || isStale(observations[0].date, series.maxAgeDays)) continue;

      const event = mapToMacroEvent(series, observations);
      if (event) events.push(event);
    } catch (err) {
      console.error(`[FRED] Failed to fetch ${series.key}:`, err);
    }
  }

  if (events.length > 0) {
    await setCache(CACHE_KEY, events, CACHE_TTL_MS);
  }

  return events;
}

/**
 * Fetch the 2-year Treasury yield minus the effective federal funds rate.
 *
 * This spread is a standard market-implied proxy for rate expectations:
 *   - Significantly negative (< -0.50): market pricing in future rate cuts
 *   - Near zero: no cuts expected, stable rates
 *   - Positive: possible further hikes
 *
 * Returns null if either series is unavailable.
 */
export async function fetchRateSpread(): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;

  const cached = await getCached<number>(RATE_SPREAD_CACHE_KEY);
  if (cached !== null) return cached;

  try {
    const [dgs2Obs, fedFundsObs] = await Promise.all([
      fetchFredSeries('DGS2', apiKey),
      fetchFredSeries('FEDFUNDS', apiKey),
    ]);

    if (dgs2Obs.length < 1 || fedFundsObs.length < 1) return null;

    const dgs2 = parseFloat(dgs2Obs[0].value);
    const fedFunds = parseFloat(fedFundsObs[0].value);

    const spread = Math.round((dgs2 - fedFunds) * 100) / 100;

    await setCache(RATE_SPREAD_CACHE_KEY, spread, RATE_SPREAD_CACHE_TTL_MS);

    return spread;
  } catch (err) {
    console.error('[FRED] Failed to fetch rate spread:', err);
    return null;
  }
}
