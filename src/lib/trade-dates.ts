import { DateTime } from 'luxon';
import type { Trade } from './types';

/** Date-only imports retain the source calendar day; no entry time is invented. */
export function tradeDay(trade: Trade, closing = true): string {
  const iso = closing ? trade.closedAt ?? trade.timestamp : trade.timestamp;
  const precision = closing && trade.closedAt ? trade.importInfo?.closedPrecision : trade.importInfo?.datePrecision;
  return precision === 'date' && trade.importInfo?.timezone ? DateTime.fromISO(iso).setZone(trade.importInfo.timezone).toISODate()! : new Date(iso).toISOString().slice(0, 10);
}
export function tradeDateLabel(trade: Trade, closing = false): string {
  const iso = closing ? trade.closedAt ?? trade.timestamp : trade.timestamp;
  const precision = closing && trade.closedAt ? trade.importInfo?.closedPrecision : trade.importInfo?.datePrecision;
  if (precision === 'date') return `${tradeDay(trade, closing)} · time unknown`;
  return new Date(iso).toLocaleString();
}
