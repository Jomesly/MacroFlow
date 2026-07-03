import { US_MARKET_HOLIDAYS } from './marketHolidays';

// Checks market open/closed for status badge only — not used in scoring logic.
// UTC date check is an acceptable approximation for a status indicator (not exact ET timezone).
// Holiday list needs yearly update — see src/lib/marketHolidays.ts.
export function marketIsOpen(symbol: string, now: Date = new Date()): boolean {
  if (symbol === 'BTCUSD') return true;
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const dateStr = now.toISOString().slice(0, 10);
  if (US_MARKET_HOLIDAYS.includes(dateStr)) return false;
  return true;
}
