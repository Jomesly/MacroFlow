import { tradeDay } from './trade-dates';
import type { Trade } from './types';

/** A saved screenshot as the day view receives it. Images load from `url`. */
export interface DayScreenshot {
  id: string;
  slot: string;
  url: string;
  width: number;
  height: number;
}

export type DayTrade = Pick<Trade,
  'id' | 'symbol' | 'direction' | 'result' | 'pnlAmount' | 'pnlAmountExact' | 'pnlPercent' | 'rMultiple'
  | 'timestamp' | 'closedAt' | 'setupTags' | 'notes' | 'journalAccountId' | 'importInfo'
> & { screenshots: DayScreenshot[] };

export interface DayTradesResponse {
  date: string;
  trades: DayTrade[];
  /** `disabled`: feature off. `unavailable`: trades loaded but images could not be listed. */
  screenshots: 'ready' | 'disabled' | 'unavailable';
  moneyComparable: boolean;
  currency: string | null;
}

/** A real calendar date in YYYY-MM-DD form. */
export function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Closed trades the P&L calendar counts on `date`, in close order. Uses the
 * calendar's own day rule (close date, else log date) so the drill-down
 * always matches the cell that was clicked.
 */
export function tradesOnDay(trades: Trade[], date: string): Trade[] {
  return trades
    .filter((trade) => trade.result !== null && tradeDay(trade) === date)
    .sort((a, b) => Date.parse(a.closedAt ?? a.timestamp) - Date.parse(b.closedAt ?? b.timestamp) || a.id.localeCompare(b.id));
}

export function toDayTrade(trade: Trade, screenshots: DayScreenshot[] = []): DayTrade {
  return {
    id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    result: trade.result,
    pnlAmount: trade.pnlAmount,
    pnlAmountExact: trade.pnlAmountExact ?? null,
    pnlPercent: trade.pnlPercent,
    rMultiple: trade.rMultiple,
    timestamp: trade.timestamp,
    closedAt: trade.closedAt,
    setupTags: trade.setupTags,
    notes: trade.notes,
    journalAccountId: trade.journalAccountId ?? null,
    importInfo: trade.importInfo ?? null,
    screenshots,
  };
}
