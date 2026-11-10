import type { CalendarEvent } from '../types';

export type ActualKind = 'pct_change' | 'change_k' | 'level' | 'level_k';
export interface UsRelease { series: string; kind: ActualKind; decimals: number }

/** Exact feed titles (USD) whose first-release value FRED publishes. Anything else is display-only. */
export const US_RELEASES: Record<string, UsRelease> = {
  'CPI m/m': { series: 'CPIAUCSL', kind: 'pct_change', decimals: 1 },
  'Core CPI m/m': { series: 'CPILFESL', kind: 'pct_change', decimals: 1 },
  'Non-Farm Employment Change': { series: 'PAYEMS', kind: 'change_k', decimals: 0 },
  'Unemployment Rate': { series: 'UNRATE', kind: 'level', decimals: 1 },
  'Retail Sales m/m': { series: 'RSAFS', kind: 'pct_change', decimals: 1 },
  'PPI m/m': { series: 'PPIFIS', kind: 'pct_change', decimals: 1 },
  'Core PCE Price Index m/m': { series: 'PCEPILFE', kind: 'pct_change', decimals: 1 },
  'Unemployment Claims': { series: 'ICSA', kind: 'level_k', decimals: 0 },
};

export interface VintageRow { date: string; value: number }

/** "0.3%" → 0.3, "145K" → 145, "1.2M" → 1200 (K units); anything else → null. */
export function parseFeedNumber(text: string | null): number | null {
  const match = text?.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([%KMB]?)$/i);
  if (!match) return null;
  const scale = { M: 1_000, B: 1_000_000 }[match[2].toUpperCase() as 'M' | 'B'] ?? 1;
  return Number(match[1]) * scale;
}

/**
 * Rows are newest first and come from the release-day vintage. FRED clips realtime dates to the
 * query window, so "published today" is detected by comparing with the day-before vintage: only a
 * newer observation than yesterday's newest counts as today's release.
 */
export function deriveActual(kind: ActualKind, decimals: number, rows: VintageRow[], previousNewest: string | null): number | null {
  const [latest, prior] = rows;
  if (!latest || !previousNewest || latest.date <= previousNewest) return null;
  let value: number;
  if (kind === 'level') value = latest.value;
  else if (kind === 'level_k') value = latest.value / 1000;
  else if (!prior) return null;
  else value = kind === 'change_k' ? latest.value - prior.value : (latest.value / prior.value - 1) * 100;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatActual(value: number, kind: ActualKind): string {
  return kind === 'change_k' || kind === 'level_k' ? `${value}K` : `${value.toFixed(1)}%`;
}

const newYorkDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

async function vintage(series: string, day: string, limit: number, apiKey: string): Promise<VintageRow[] | null> {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  for (const [key, value] of Object.entries({ series_id: series, api_key: apiKey, file_type: 'json',
    realtime_start: day, realtime_end: day, sort_order: 'desc', limit: String(limit) })) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data.observations)) return null;
  return data.observations.map((o: { date?: unknown; value?: unknown }) => ({ date: String(o.date), value: Number(o.value) }));
}

export async function fetchUsActual(event: CalendarEvent, apiKey: string): Promise<string | null> {
  const release = event.currency === 'USD' ? US_RELEASES[event.title] : undefined;
  if (!release) return null;
  const releaseDate = newYorkDate(event.time);
  const dayBefore = new Date(Date.parse(`${releaseDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  try {
    const [today, before] = await Promise.all([
      vintage(release.series, releaseDate, 3, apiKey),
      vintage(release.series, dayBefore, 1, apiKey),
    ]);
    if (!today || !before || today.slice(0, 2).some(row => !Number.isFinite(row.value))) return null;
    const value = deriveActual(release.kind, release.decimals, today, before[0]?.date ?? null);
    return value === null ? null : formatActual(value, release.kind);
  } catch {
    // Do not log request URLs: they contain API credentials.
    return null;
  }
}
