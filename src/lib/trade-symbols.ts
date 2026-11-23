import { TRADE_SYMBOLS, type TradeSymbol } from './types';

// Broker names for the same underlying market (Pepperstone NAS100, IC/Exness
// USTEC, Bybit/FundedNext SPX500, Dukascopy-style US30, ...).
const BROKER_ALIASES: Readonly<Record<string, TradeSymbol>> = {
  GOLD: 'XAUUSD',
  NAS100: 'US100', NASDAQ: 'US100', NASDAQ100: 'US100', NDX: 'US100', NDX100: 'US100',
  NQ100: 'US100', USTEC: 'US100', USTECH: 'US100', USTECH100: 'US100', USA100: 'US100',
  SPX: 'US500', SPX500: 'US500', SP500: 'US500', USA500: 'US500',
  US30: 'DJ30', DOW: 'DJ30', DOW30: 'DJ30', DJI: 'DJ30', DJI30: 'DJ30', DJIA: 'DJ30',
  WS30: 'DJ30', USA30: 'DJ30',
  BTCUSDT: 'BTCUSD', XBTUSD: 'BTCUSD', BITCOIN: 'BTCUSD',
};

// Account-type markers glued on without a separator in upper case
// (XM's US100Cash, legacy XAUUSDM).
const GLUED_SUFFIXES = ['CASH', 'M'];

function lookup(name: string): TradeSymbol | null {
  if ((TRADE_SYMBOLS as string[]).includes(name)) return name as TradeSymbol;
  return Object.hasOwn(BROKER_ALIASES, name) ? BROKER_ALIASES[name] : null;
}

/**
 * Map a broker's symbol name to a journal market, or null for any other
 * instrument. Handles separator suffixes (USDCAD+, XAUUSD.pro, EURUSD_i),
 * lowercase account-type tails (EURUSDm, XAUUSDpro), split pairs (EUR/USD)
 * and common index/commodity names (SPX500, NAS100, GOLD). Unknown names
 * are rejected rather than guessed: a wrong market is worse than a skipped row.
 */
export function normalizeTradeSymbol(raw: string): TradeSymbol | null {
  const joined = raw.trim().replace(/^([A-Za-z]{3})[/_ ]([A-Za-z]{3,4})/, '$1$2');
  const core = /^[^A-Za-z0-9]*([A-Za-z0-9]+)/.exec(joined)?.[1];
  if (!core) return null;

  const upper = core.toUpperCase();
  const exact = lookup(upper);
  if (exact) return exact;

  const lowercaseTail = /^([A-Z0-9]+)[a-z]{1,5}$/.exec(core);
  const fromTail = lowercaseTail ? lookup(lowercaseTail[1]) : null;
  if (fromTail) return fromTail;

  for (const suffix of GLUED_SUFFIXES) {
    if (upper.endsWith(suffix)) {
      const head = lookup(upper.slice(0, -suffix.length));
      if (head) return head;
    }
  }
  return null;
}
