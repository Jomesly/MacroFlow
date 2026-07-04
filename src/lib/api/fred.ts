import { MacroEvent } from '../types';
import { getCached, setCache } from './cache';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred';
const CACHE_KEY = 'fred_events';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const STALE_DAYS = 35;

interface FredObservation {
  date: string;
  value: string;
}

interface FredSeriesResponse {
  observations: FredObservation[];
  realtime_start: string;
  realtime_end: string;
}

const FRED_SERIES = [
  {
    key: 'CPI',
    seriesId: 'CPIAUCSL',
    category: 'inflation' as const,
    title: 'US Consumer Price Index',
    impact: 'high' as const,
  },
  {
    key: 'UNEMPLOYMENT',
    seriesId: 'UNRATE',
    category: 'employment' as const,
    title: 'US Unemployment Rate',
    impact: 'medium' as const,
  },
  {
    key: 'NFP',
    seriesId: 'PAYEMS',
    category: 'employment' as const,
    title: 'US Nonfarm Payrolls',
    impact: 'high' as const,
  },
  {
    key: 'GDP',
    seriesId: 'GDP',
    category: 'gdp' as const,
    title: 'US Gross Domestic Product',
    impact: 'high' as const,
  },
  {
    key: 'RETAIL_SALES',
    seriesId: 'RSXFS',
    category: 'retail_sales' as const,
    title: 'US Retail Sales',
    impact: 'medium' as const,
  },
];

function isStale(dateStr: string): boolean {
  const obsDate = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - obsDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > STALE_DAYS;
}

async function fetchFredSeries(seriesId: string, apiKey: string): Promise<FredObservation[]> {
  const url = new URL(`${FRED_BASE_URL}/series/observations`);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '2');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`FRED API error: ${response.status} ${response.statusText}`);
  }
  const data: FredSeriesResponse = await response.json();
  return data.observations;
}

function mapToMacroEvent(
  series: typeof FRED_SERIES[number],
  latest: FredObservation,
  previous: FredObservation,
): MacroEvent | null {
  const latestVal = parseFloat(latest.value);
  const prevVal = parseFloat(previous.value);
  if (isNaN(latestVal) || isNaN(prevVal)) return null;

  let value: string;
  let description: string;

  if (series.key === 'CPI') {
    if (latestVal > prevVal) {
      value = 'high';
      description = `US CPI rose to ${latestVal} from ${prevVal} (inflationary)`;
    } else if (latestVal < prevVal) {
      value = 'low';
      description = `US CPI fell to ${latestVal} from ${prevVal} (disinflationary)`;
    } else {
      value = 'neutral';
      description = `US CPI unchanged at ${latestVal}`;
    }
  } else if (series.key === 'UNEMPLOYMENT') {
    if (latestVal > prevVal) {
      value = 'weak';
      description = `US Unemployment rose to ${latestVal}% from ${prevVal}% (weakening labor)`;
    } else if (latestVal < prevVal) {
      value = 'strong';
      description = `US Unemployment fell to ${latestVal}% from ${prevVal}% (strengthening labor)`;
    } else {
      value = 'neutral';
      description = `US Unemployment unchanged at ${latestVal}%`;
    }
  } else if (series.key === 'NFP') {
    if (latestVal > prevVal) {
      value = 'strong';
      description = `US Nonfarm Payrolls rose to ${latestVal} from ${prevVal} (job growth)`;
    } else if (latestVal < prevVal) {
      value = 'weak';
      description = `US Nonfarm Payrolls fell to ${latestVal} from ${prevVal} (job losses)`;
    } else {
      value = 'neutral';
      description = `US Nonfarm Payrolls unchanged at ${latestVal}`;
    }
  } else if (series.key === 'GDP') {
    if (latestVal > prevVal) {
      value = 'beat';
      description = `US GDP rose to ${latestVal}B from ${prevVal}B (expansion)`;
    } else if (latestVal < prevVal) {
      value = 'miss';
      description = `US GDP fell to ${latestVal}B from ${prevVal}B (contraction)`;
    } else {
      value = 'neutral';
      description = `US GDP unchanged at ${latestVal}B`;
    }
  } else if (series.key === 'RETAIL_SALES') {
    if (latestVal > prevVal) {
      value = 'beat';
      description = `US Retail Sales rose to ${latestVal} from ${prevVal} (consumer strength)`;
    } else if (latestVal < prevVal) {
      value = 'miss';
      description = `US Retail Sales fell to ${latestVal} from ${prevVal} (consumer weakness)`;
    } else {
      value = 'neutral';
      description = `US Retail Sales unchanged at ${latestVal}`;
    }
  } else {
    return null;
  }

  return {
    id: `fred_${series.key}_${latest.date}`,
    category: series.category,
    title: series.title,
    description,
    timestamp: new Date(latest.date).toISOString(),
    impact: series.impact,
    value,
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
      if (observations.length < 2) continue;

      const [latest, previous] = observations;
      if (isStale(latest.date)) continue;

      const event = mapToMacroEvent(series, latest, previous);
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
