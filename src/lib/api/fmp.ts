import { MacroEvent } from '../types';
import { classifyEconomicEvent } from './classifier';
import { getCached, setCache } from './cache';

const BASE_URL = 'https://financialmodelingprep.com/api/v3';
const CACHE_KEY = 'fmp_economic_calendar';
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

export async function fetchEconomicCalendar(): Promise<MacroEvent[]> {
  const cached = getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `${BASE_URL}/economic_calendar?from=${today}&to=${today}&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) return [];

    const data: FmpEconomicEvent[] = await res.json();
    if (!Array.isArray(data)) return [];

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
          impact: 'medium',
          value: classified.value,
          sourceName: 'fmp',
        });
      }
    }

    setCache(CACHE_KEY, events, CACHE_TTL);
    return events;
  } catch {
    return [];
  }
}
