import type { GradedResult } from '../bias-snapshot';
import type { SignalRow } from './types';

/** One signal per market per window: the next can start only after the last one's four hours (plus entry) end. */
export const SIGNAL_SPACING_MS = 5 * 3_600_000;

/** One id per market and UTC hour, so a repeated scheduler run cannot record a second row. */
export function signalId(symbol: string, asOf: string): string {
  return `${symbol}:${asOf.slice(0, 13)}`;
}

/** The A/B signals to record now, skipping any market whose previous signal window is still running. */
export function selectNewSignals(results: GradedResult[], recent: Pick<SignalRow, 'symbol' | 'issuedAt'>[], asOf: string, version: string): SignalRow[] {
  const now = Date.parse(asOf);
  return results.flatMap(result => {
    const { grade, side, checks } = result.grade;
    if (grade === 'none' || !side) return [];
    if (recent.some(row => row.symbol === result.symbol && now - Date.parse(row.issuedAt) < SIGNAL_SPACING_MS)) return [];
    return [{ id: signalId(result.symbol, asOf), symbol: result.symbol, side, grade, forecastVersion: version,
      biasScore: result.biasScore, issuedAt: asOf, checks, outcome: 'open' as const,
      entryAt: null, exitAt: null, entryPrice: null, exitPrice: null, returnBps: null }];
  });
}
