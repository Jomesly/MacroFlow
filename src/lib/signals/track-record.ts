import { wilson } from '../probability/model';
import { gradeBadge, type SignalGradeResult } from '../signal-grade';
import type { AssetSymbol } from '../types';
import type { SignalRow } from './types';

/**
 * The gate for the words "High probability", fixed before any outcome was recorded:
 * at least 100 resolved signals, entries on 30 different days, and a 95% range whose
 * lower edge is still at least 55% right. Roughly a 65% hit rate at 100 signals.
 */
export const PROVEN_MIN_SIGNALS = 100;
export const PROVEN_MIN_DAYS = 30;
export const PROVEN_MIN_LOWER_BOUND = 0.55;

type Grade = 'A' | 'B';
export interface GradeStats { n: number; wins: number; hitRate: number | null; interval95: [number, number] | null; days: number; avgReturnBps: number | null; proven: boolean }
export interface TrackRecord { version: string; overall: Record<Grade, GradeStats>; bySymbol: Partial<Record<AssetSymbol, Record<Grade, GradeStats>>> }
/** GET /api/signals/track-record; `available` is false when results could not be read. */
export type TrackRecordResponse = TrackRecord & { available: boolean };

function stats(rows: SignalRow[]): GradeStats {
  const n = rows.length, wins = rows.filter(row => row.outcome === 'win').length;
  if (!n) return { n: 0, wins: 0, hitRate: null, interval95: null, days: 0, avgReturnBps: null, proven: false };
  const interval95 = wilson(wins, n);
  const days = new Set(rows.map(row => (row.entryAt ?? row.issuedAt).slice(0, 10))).size;
  const avgReturnBps = Math.round(rows.reduce((sum, row) => sum + (row.returnBps ?? 0), 0) / n * 100) / 100;
  return { n, wins, hitRate: wins / n, interval95, days, avgReturnBps,
    proven: n >= PROVEN_MIN_SIGNALS && days >= PROVEN_MIN_DAYS && interval95[0] >= PROVEN_MIN_LOWER_BOUND };
}

const byGrade = (rows: SignalRow[]): Record<Grade, GradeStats> => ({
  A: stats(rows.filter(row => row.grade === 'A')), B: stats(rows.filter(row => row.grade === 'B')),
});

/** Results of resolved signals for this forecast version only; a new version starts a new record. */
export function summarizeTrackRecord(rows: SignalRow[], version: string): TrackRecord {
  const resolved = rows.filter(row => row.forecastVersion === version && (row.outcome === 'win' || row.outcome === 'loss'));
  const bySymbol: TrackRecord['bySymbol'] = {};
  for (const symbol of new Set(resolved.map(row => row.symbol))) bySymbol[symbol] = byGrade(resolved.filter(row => row.symbol === symbol));
  return { version, overall: byGrade(resolved), bySymbol };
}

/** The card's badge and the line under it. "High probability" appears only for a proven grade. */
export function gradeLabel(grade: SignalGradeResult, record: GradeStats | undefined): { badge: string; detail: string } {
  const badge = gradeBadge(grade);
  if (grade.grade === 'none') return { badge, detail: '' };
  if (record?.proven && record.hitRate !== null) {
    return { badge, detail: `High probability · right ${Math.round(record.hitRate * 100)}% of the time over 4 h (all markets, n=${record.n})` };
  }
  return { badge, detail: `Unproven · ${record?.n ?? 0}/${PROVEN_MIN_SIGNALS} results` };
}
