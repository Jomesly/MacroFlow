import { MacroEvent, UpcomingEvent } from '../types';
import { classifyEconomicEvent } from './classifier';
import { getCached, setCache } from './cache';

const BASE_URL = 'https://financialmodelingprep.com/api/v3';
const CACHE_KEY = 'fmp_economic_calendar';
const UPCOMING_CACHE_KEY = 'fmp_upcoming_calendar';
const CACHE_TTL = 300_000;

interface FmpEconomicEvent {
  event: string;
  country: string;
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  description: string | null;
}

function eventImpact(eventName: string): 'high' | 'medium' {
  return /cpi|inflation|nonfarm|payroll|nfp|employment|unemployment|gdp|interest rate|fed|boe|bank of england/i.test(eventName)
    ? 'high'
    : 'medium';
}

function affectsSymbols(country: string, eventName: string): UpcomingEvent['affects'] {
  const normalized = country.toUpperCase();
  if (normalized === 'GB' || normalized === 'UK' || /boe|bank of england/i.test(eventName)) {
    return ['GBPUSD'];
  }
  return ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
}

async function fetchRawCalendar(): Promise<FmpEconomicEvent[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `${BASE_URL}/economic_calendar?from=${from}&to=${to}&apikey=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) throw new Error('FMP economic calendar request failed');

  const data: FmpEconomicEvent[] = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchEconomicCalendar(): Promise<MacroEvent[]> {
  const cached = await getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  try {
    const data = await fetchRawCalendar();

    const events: MacroEvent[] = [];

    for (const item of data) {
      const classified = classifyEconomicEvent(
        item.event,
        item.actual,
        item.forecast
      );

      if (classified) {
        const actualStr = item.actual !== null ? `Actual: ${item.actual}` : 'Pending';
        const forecastStr = item.forecast !== null ? `Forecast: ${item.forecast}` : 'N/A';
        const title = `${item.country} ${item.event} — ${actualStr} (${forecastStr})`;

        events.push({
          id: `fmp-${item.event.replace(/\s+/g, '-').toLowerCase()}-${item.date}`,
          category: classified.category,
          title,
          description: item.description ?? title,
          timestamp: new Date(item.date).toISOString(),
          impact: eventImpact(item.event),
          value: classified.value,
          country: item.country,
          sourceName: 'fmp',
        });
      }
    }

    await setCache(CACHE_KEY, events, CACHE_TTL);
    return events;
  } catch {
    throw new Error('FMP economic calendar unavailable');
  }
}

export async function fetchUpcomingEconomicCalendar(): Promise<UpcomingEvent[]> {
  const cached = await getCached<UpcomingEvent[]>(UPCOMING_CACHE_KEY);
  if (cached) return cached;

  try {
    const now = Date.now();
    const data = await fetchRawCalendar();
    const upcoming = data
      .filter((item) => item.actual === null && new Date(item.date).getTime() > now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((item) => ({
        name: item.event,
        country: item.country,
        date: new Date(item.date).toISOString(),
        impact: eventImpact(item.event),
        affects: affectsSymbols(item.country, item.event),
      }));

    await setCache(UPCOMING_CACHE_KEY, upcoming, CACHE_TTL);
    return upcoming;
  } catch {
    return [];
  }
}
