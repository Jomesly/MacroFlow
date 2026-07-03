/**
 * Fetch historical economic calendar events from FMP.
 *
 * FMP free tier: 250 calls/day, supports historical date ranges.
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

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const API_KEY = process.env.FMP_API_KEY || '';

interface FmpEconomicEvent {
  event: string;
  country: string;
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  description: string | null;
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

function dateRangeChunks(start: string, end: string, chunkDays: number): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let current = new Date(start);
  const endDt = new Date(end);

  while (current < endDt) {
    const chunkEnd = new Date(current.getTime() + chunkDays * 24 * 60 * 60 * 1000);
    if (chunkEnd > endDt) chunkEnd.setTime(endDt.getTime());
    chunks.push({
      from: current.toISOString().slice(0, 10),
      to: chunkEnd.toISOString().slice(0, 10),
    });
    current = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000); // next day
  }
  return chunks;
}

async function fetchChunk(from: string, to: string): Promise<FmpEconomicEvent[]> {
  const url = `${FMP_BASE}/economic_calendar?from=${from}&to=${to}&apikey=${API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    console.error(`  FMP error for ${from}/${to}: ${res.status}`);
    return [];
  }

  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data;
}

async function main() {
  if (!API_KEY) {
    console.error('FMP_API_KEY not set');
    process.exit(1);
  }

  const daysBack = parseInt(process.argv[2] || '30', 10);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  console.log(`Fetching economic calendar: ${startStr} to ${endStr}`);

  const chunks = dateRangeChunks(startStr, endStr, 7); // 7-day chunks
  console.log(`Will fetch ${chunks.length} chunks (7-day each)`);

  const allEvents: CalendarEvent[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < chunks.length; i++) {
    const { from, to } = chunks[i];
    console.log(`  [${i + 1}/${chunks.length}] Fetching ${from} to ${to}...`);

    const raw = await fetchChunk(from, to);

    for (const item of raw) {
      // Only keep events with actual data (released events)
      if (item.actual === null) continue;

      const id = `${item.date}-${item.event}-${item.country}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      allEvents.push({
        id,
        event: item.event,
        country: item.country,
        date: item.date,
        actual: item.actual,
        forecast: item.forecast,
        previous: item.previous,
      });
    }

    // Rate limit: wait 500ms between chunks
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Sort by date
  allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const outDir = path.join(process.cwd(), 'data', 'historical-calendar');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'events.json');
  fs.writeFileSync(outFile, JSON.stringify(allEvents, null, 2));
  console.log(`\nSaved ${allEvents.length} events to ${outFile}`);
}

main().catch(console.error);
