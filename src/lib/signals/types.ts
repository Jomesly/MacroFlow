import type { GradeCheck } from '../signal-grade';
import type { AssetSymbol } from '../types';

export type SignalOutcome = 'open' | 'win' | 'loss' | 'void';

/** One recorded A/B signal and, once resolved, how it turned out four hours later. */
export interface SignalRow {
  id: string;
  symbol: AssetSymbol;
  side: 'long' | 'short';
  grade: 'A' | 'B';
  forecastVersion: string;
  biasScore: number;
  issuedAt: string;
  checks: GradeCheck[];
  outcome: SignalOutcome;
  entryAt: string | null;
  exitAt: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  returnBps: number | null;
}

/** The same row as stored in supabase/signal-outcomes.sql. */
export interface SignalDbRow {
  id: string;
  symbol: AssetSymbol;
  side: 'long' | 'short';
  grade: 'A' | 'B';
  forecast_version: string;
  bias_score: number;
  issued_at: string;
  checks: GradeCheck[];
  outcome: SignalOutcome;
  entry_at: string | null;
  exit_at: string | null;
  entry_price: number | null;
  exit_price: number | null;
  return_bps: number | null;
}

export function toDbRow(row: SignalRow): SignalDbRow {
  return { id: row.id, symbol: row.symbol, side: row.side, grade: row.grade, forecast_version: row.forecastVersion,
    bias_score: row.biasScore, issued_at: row.issuedAt, checks: row.checks, outcome: row.outcome, entry_at: row.entryAt,
    exit_at: row.exitAt, entry_price: row.entryPrice, exit_price: row.exitPrice, return_bps: row.returnBps };
}

export function fromDbRow(row: SignalDbRow): SignalRow {
  return { id: row.id, symbol: row.symbol, side: row.side, grade: row.grade, forecastVersion: row.forecast_version,
    biasScore: row.bias_score, issuedAt: new Date(row.issued_at).toISOString(), checks: row.checks, outcome: row.outcome,
    entryAt: row.entry_at && new Date(row.entry_at).toISOString(), exitAt: row.exit_at && new Date(row.exit_at).toISOString(),
    entryPrice: row.entry_price, exitPrice: row.exit_price, returnBps: row.return_bps };
}
