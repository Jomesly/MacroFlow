import type { IntradayBar } from '../market-evidence';
import type { SignalRow } from './types';

const HOUR_MS = 3_600_000;
export const HOLD_HOURS = 4;
/** Late bars are allowed for two hours before a broken window is voided. */
const GRACE_MS = 2 * HOUR_MS;
/** Without an entry bar this long after the signal, the market was closed or the data is missing. */
const NO_ENTRY_VOID_MS = 6 * HOUR_MS;

export type Resolution = Pick<SignalRow, 'outcome' | 'entryAt' | 'exitAt' | 'entryPrice' | 'exitPrice' | 'returnBps'>;
const OPEN: Resolution = { outcome: 'open', entryAt: null, exitAt: null, entryPrice: null, exitPrice: null, returnBps: null };
const VOID: Resolution = { ...OPEN, outcome: 'void' };

/**
 * Same rule as docs/macro-probability.md: enter at the first hourly open strictly after the
 * signal (within one hour), exit at the close four contiguous hours later. A flat result is a
 * loss. A closed market or missing hour makes the signal void, never a loss.
 */
export function resolveSignal(row: Pick<SignalRow, 'issuedAt' | 'side'>, bars: IntradayBar[], now: string): Resolution {
  const nowMs = Date.parse(now), issued = Date.parse(row.issuedAt);
  const known = bars.filter(bar => Date.parse(bar.closeTime) <= nowMs);
  const entry = known.filter(bar => Date.parse(bar.openTime) > issued).sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime))[0];
  if (!entry || Date.parse(entry.openTime) - issued > HOUR_MS) return nowMs >= issued + NO_ENTRY_VOID_MS ? VOID : OPEN;
  const start = Date.parse(entry.openTime);
  const window = Array.from({ length: HOLD_HOURS }, (_, i) => known.find(bar =>
    Date.parse(bar.openTime) === start + i * HOUR_MS && Date.parse(bar.closeTime) === start + (i + 1) * HOUR_MS));
  const exit = window.at(-1);
  if (window.some(bar => !bar) || !exit) return nowMs >= start + HOLD_HOURS * HOUR_MS + GRACE_MS ? VOID : OPEN;
  const direction = row.side === 'long' ? 1 : -1;
  const returnBps = Math.round((exit.close / entry.open - 1) * 10_000 * direction * 100) / 100;
  return { outcome: returnBps > 0 ? 'win' : 'loss', entryAt: entry.openTime, exitAt: exit.closeTime,
    entryPrice: entry.open, exitPrice: exit.close, returnBps };
}
