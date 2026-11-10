import fs from 'node:fs';
import path from 'node:path';
import { fetchFredSnapshot } from '../src/lib/api/fred-client';
import { completedVintageDate, DAY_MS, type FredSnapshot } from '../src/lib/macro-context';
import { loadLocalEnvironment, daysArgument } from './lib/environment';

async function main() {
  loadLocalEnvironment();
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY is required');
  const days = daysArgument();
  const endDate = completedVintageDate(new Date().toISOString());
  const end = Date.parse(endDate + 'T00:00:00Z');
  const dir = path.join('data', 'validation-v3', 'fred');
  fs.mkdirSync(dir, { recursive: true });
  let complete = 0;
  let failed = 0;
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(end - offset * DAY_MS).toISOString().slice(0, 10);
    const file = path.join(dir, `${date}.json`);
    const existing: FredSnapshot | null = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (existing?.schemaVersion === 1 && existing.vintageDate === date && existing.failedSeries.length === 0) { complete++; continue; }
    const snapshot = await fetchFredSnapshot(date, key);
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
    if (snapshot.failedSeries.length) failed++; else complete++;
    console.log(`${date}: ${snapshot.failedSeries.length ? `missing ${snapshot.failedSeries.join(', ')}` : 'point-in-time snapshot saved'}`);
    if (snapshot.failedSeries.length === 9) throw new Error('All FRED series failed; stopping acquisition');
    // Nine requests per snapshot; remain below 120 requests/minute.
    if (offset > 0) await new Promise(resolve => setTimeout(resolve, 6000));
  }
  console.log(JSON.stringify({ complete, partial: failed, days, vintagePolicy: 'both real-time bounds set; usable next UTC day' }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Historical acquisition failed'); process.exitCode = 1; });
