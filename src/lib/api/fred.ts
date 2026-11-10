import { buildMacroInputs, completedVintageDate, type FredSnapshot } from '../macro-context';
import { fetchFredSnapshot } from './fred-client';
import { getCached, setCache } from './cache';

export async function fetchFredInputs(asOf = new Date().toISOString()) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return { ...buildMacroInputs(null, asOf), failed: true };
  const vintageDate = completedVintageDate(asOf);
  const key = `fred_snapshot_v3:${vintageDate}`;
  let snapshot = await getCached<FredSnapshot>(key);
  if (!snapshot) {
    snapshot = await fetchFredSnapshot(vintageDate, apiKey);
    await setCache(key, snapshot, snapshot.failedSeries.length ? 60_000 : 6 * 3_600_000);
  }
  return { ...buildMacroInputs(snapshot, asOf), failed: snapshot.failedSeries.length > 0 };
}

export async function fetchFredEvents() {
  return (await fetchFredInputs()).events;
}

/** Daily DGS2 minus daily DFF on a matched observation date. */
export async function fetchRateSpread(): Promise<number | null> {
  return (await fetchFredInputs()).context.rateSpread;
}
