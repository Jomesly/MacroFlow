/**
 * Fetch historical economic data from ALFRED (Archival FRED).
 *
 * Uses vintage dates to get point-in-time data — each observation reflects
 * what was actually known on that date, not later revisions. This prevents
 * look-ahead bias in the backtest.
 *
 * Series: CPIAUCSL, UNRATE, PAYEMS, GDP, RSXFS
 * Logic: compare each release to previous release (same as fred.ts live)
 *
 * Outputs: data/historical-calendar/events.json
 *
 * Usage: npx tsx scripts/fetch-historical-calendar.ts [days_back]
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = value;
    }
  }
}

const API_KEY = process.env.FRED_API_KEY || '';
const FRED_BASE = 'https://api.stlouisfed.org/fred';

interface FredObservation {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
}

interface FredVintageResponse {
  vintage_dates: string[];
  count: number;
}

interface FredObservationsResponse {
  observations: FredObservation[];
  realtime_start: string;
  realtime_end: string;
}

interface CalendarEvent {
  id: string;
  event: string;
  country: string;
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
}

// Series configuration — matches fred.ts live dashboard
const SERIES_CONFIG = [
  {
    seriesId: 'CPIAUCSL',
    eventName: 'CPI',
    country: 'US',
    // CPI is monthly, released around 10th-13th
  },
  {
    seriesId: 'UNRATE',
    eventName: 'Unemployment Rate',
    country: 'US',
    // Unemployment is monthly, released first Friday
  },
  {
    seriesId: 'PAYEMS',
    eventName: 'Nonfarm Payrolls',
    country: 'US',
    // NFP is monthly, released first Friday
  },
  {
    seriesId: 'GDP',
    eventName: 'GDP',
    country: 'US',
    // GDP is quarterly, released ~30 days after quarter end
  },
  {
    seriesId: 'RSXFS',
    eventName: 'Retail Sales',
    country: 'US',
    // Retail Sales is monthly, released around 15th-17th
  },
];

async function fetchVintageDates(seriesId: string): Promise<string[]> {
  const url = `${FRED_BASE}/series/vintagedates?series_id=${seriesId}&api_key=${API_KEY}&file_type=json&sort_order=desc&limit=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`  FRED vintagedates error for ${seriesId}: ${res.status}`);
    return [];
  }
  const data: FredVintageResponse = await res.json();
  return data.vintage_dates || [];
}

async function fetchObservationsAsOf(
  seriesId: string,
  realtimeEnd: string
): Promise<FredObservation[]> {
  const url = `${FRED_BASE}/series/observations?series_id=${seriesId}&api_key=${API_KEY}&file_type=json&sort_order=desc&limit=10&realtime_end=${realtimeEnd}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`  FRED observations error for ${seriesId} as of ${realtimeEnd}: ${res.status}`);
    return [];
  }
  const data: FredObservationsResponse = await res.json();
  return data.observations || [];
}

function classifyValue(
  eventName: string,
  current: number,
  previous: number
): string {
  const name = eventName.toLowerCase();

  if (name.includes('cpi')) {
    return current > previous ? 'high' : current < previous ? 'low' : 'neutral';
  }
  if (name.includes('unemployment')) {
    // Higher unemployment = weak labor market
    return current > previous ? 'weak' : current < previous ? 'strong' : 'neutral';
  }
  if (name.includes('payroll') || name.includes('nfp')) {
    return current > previous ? 'strong' : current < previous ? 'weak' : 'neutral';
  }
  if (name.includes('gdp')) {
    return current > previous ? 'beat' : current < previous ? 'miss' : 'neutral';
  }
  if (name.includes('retail sales')) {
    return current > previous ? 'beat' : current < previous ? 'miss' : 'neutral';
  }

  return 'neutral';
}

function getImpact(eventName: string): string {
  const name = eventName.toLowerCase();
  if (name.includes('cpi') || name.includes('payroll') || name.includes('nfp') || name.includes('gdp')) {
    return 'high';
  }
  return 'medium';
}

async function main() {
  if (!API_KEY) {
    console.error('FRED_API_KEY not set');
    process.exit(1);
  }

  const daysBack = parseInt(process.argv[2] || '180', 10);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  console.log(`Fetching ALFRED historical data from ${cutoffStr} to today`);
  console.log(`Series: ${SERIES_CONFIG.map(s => s.seriesId).join(', ')}`);

  const allEvents: CalendarEvent[] = [];
  const seenIds = new Set<string>();

  for (const config of SERIES_CONFIG) {
    console.log(`\nFetching vintage dates for ${config.seriesId}...`);
    const vintageDates = await fetchVintageDates(config.seriesId);

    // Filter to dates within our range
    const relevantDates = vintageDates.filter(d => d >= cutoffStr);
    console.log(`  Found ${relevantDates.length} vintage dates in range`);

    // For each vintage date, get observations as they were known then
    let previousObservations: Map<string, number> = new Map();

    for (let i = 0; i < relevantDates.length; i++) {
      const vintageDate = relevantDates[i];

      // Rate limit: wait 200ms between requests
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }

      const observations = await fetchObservationsAsOf(config.seriesId, vintageDate);

      if (observations.length < 1) continue;

      // Get the latest observation as of this vintage date
      const latest = observations[0];
      const currentVal = parseFloat(latest.value);
      if (isNaN(currentVal)) continue;

      // Get the previous observation (second most recent as of this vintage)
      const prevObs = observations.length >= 2 ? observations[1] : null;
      const prevVal = prevObs ? parseFloat(prevObs.value) : null;

      // We need at least 2 observations to classify beat/miss
      if (prevVal === null || isNaN(prevVal)) continue;

      // Check if this is a new data release (not just a revision)
      // A new release happens when the observation date changes
      const obsDateKey = `${config.seriesId}:${latest.date}`;
      const prevKey = `${config.seriesId}:${prevObs.date}`;

      // Skip if we already processed this exact observation pair
      if (seenIds.has(obsDateKey)) continue;

      const value = classifyValue(config.eventName, currentVal, prevVal);

      // Skip neutral (no change) — not useful for backtest
      if (value === 'neutral') continue;

      seenIds.add(obsDateKey);

      const event: CalendarEvent = {
        id: `fred-${config.seriesId}-${latest.date}`,
        event: config.eventName,
        country: config.country,
        // Use the vintage date as the event date (when the data became known)
        date: new Date(vintageDate).toISOString(),
        actual: currentVal,
        forecast: null, // FRED doesn't provide forecasts
        previous: prevVal,
      };

      allEvents.push(event);
    }
  }

  // Sort by date
  allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Deduplicate by id
  const uniqueEvents = allEvents.filter(e => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  const outDir = path.join(process.cwd(), 'data', 'historical-calendar');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'events.json');
  fs.writeFileSync(outFile, JSON.stringify(uniqueEvents, null, 2));

  console.log(`\nSaved ${uniqueEvents.length} events to ${outFile}`);

  // Print summary by series
  const bySeries: Record<string, number> = {};
  for (const e of uniqueEvents) {
    bySeries[e.event] = (bySeries[e.event] || 0) + 1;
  }
  console.log('\nEvents by series:');
  for (const [event, count] of Object.entries(bySeries)) {
    console.log(`  ${event}: ${count}`);
  }

  // Print date range
  if (uniqueEvents.length > 0) {
    const first = uniqueEvents[0].date;
    const last = uniqueEvents[uniqueEvents.length - 1].date;
    console.log(`\nDate range: ${first.slice(0, 10)} to ${last.slice(0, 10)}`);
  }
}

main().catch(console.error);
