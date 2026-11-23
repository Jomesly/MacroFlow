import type { IntradayBar } from '../market-evidence';
import type { AssetSymbol } from '../types';
import type { SignalRow } from './types';

const HOUR_MS = 3_600_000;
export const HOLD_HOURS = 4;
/** Late bars are allowed for two hours before a broken window is voided. */
const GRACE_MS = 2 * HOUR_MS;
/** Without an entry bar this long after the signal, the market was closed or the data is missing. */
const NO_ENTRY_VOID_MS = 6 * HOUR_MS;
/** Futures pause for one hour a day (22:00–23:00 UTC); four trading hours may span that one gap. */
const MAX_WINDOW_MS = (HOLD_HOURS + 1) * HOUR_MS;
const MAX_BAR_GAP_MS = 2 * HOUR_MS;

/**
 * Hourly price series used to score outcomes. Stock indices use futures, which trade about
 * 23 hours a day on the hour; the cash indices only exist 14:30–21:00 UTC, so most signals
 * issued outside that window could never be scored.
 */
export const RESOLUTION_TICKERS: Readonly<Record<AssetSymbol, string>> = {
  US500: 'ES=F', US100: 'NQ=F', DJ30: 'YM=F', XAUUSD: 'GC=F', BTCUSD: 'BTC-USD',
  GBPUSD: 'GBPUSD=X', EURUSD: 'EURUSD=X', USDJPY: 'JPY=X', USDCHF: 'CHF=X', AUDUSD: 'AUDUSD=X', USDCAD: 'CAD=X', NZDUSD: 'NZDUSD=X',
};

export type Resolution = Pick<SignalRow, 'outcome' | 'entryAt' | 'exitAt' | 'entryPrice' | 'exitPrice' | 'returnBps'>;
const OPEN: Resolution = { outcome: 'open', entryAt: null, exitAt: null, entryPrice: null, exitPrice: null, returnBps: null };
const VOID: Resolution = { ...OPEN, outcome: 'void' };

/**
 * Enter at the first hourly open strictly after the signal (within one hour) and exit at the
 * close of the fourth hourly bar. The four trading hours may span one short pause (the daily
 * futures break) but must finish within five hours. A flat result is a loss. A closed market
 * or broken window makes the signal void, never a loss.
 */
export function resolveSignal(row: Pick<SignalRow, 'issuedAt' | 'side'>, bars: IntradayBar[], now: string): Resolution {
  const nowMs = Date.parse(now), issued = Date.parse(row.issuedAt);
  const known = bars.filter(bar => Date.parse(bar.closeTime) <= nowMs && Date.parse(bar.closeTime) - Date.parse(bar.openTime) === HOUR_MS)
    .sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime));
  const entry = known.find(bar => Date.parse(bar.openTime) > issued);
  if (!entry || Date.parse(entry.openTime) - issued > HOUR_MS) return nowMs >= issued + NO_ENTRY_VOID_MS ? VOID : OPEN;
  const start = Date.parse(entry.openTime);
  const window = [entry];
  for (const bar of known.filter(candidate => Date.parse(candidate.openTime) > start)) {
    if (window.length === HOLD_HOURS) break;
    if (Date.parse(bar.openTime) - Date.parse(window.at(-1)!.openTime) > MAX_BAR_GAP_MS
      || Date.parse(bar.closeTime) - start > MAX_WINDOW_MS) break;
    window.push(bar);
  }
  const exit = window.at(-1)!;
  if (window.length < HOLD_HOURS) return nowMs >= start + MAX_WINDOW_MS + GRACE_MS ? VOID : OPEN;
  const direction = row.side === 'long' ? 1 : -1;
  const returnBps = Math.round((exit.close / entry.open - 1) * 10_000 * direction * 100) / 100;
  return { outcome: returnBps > 0 ? 'win' : 'loss', entryAt: entry.openTime, exitAt: exit.closeTime,
    entryPrice: entry.open, exitPrice: exit.close, returnBps };
}
