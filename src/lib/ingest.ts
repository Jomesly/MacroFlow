import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TRADE_SYMBOLS, TradeDirection, TradeResult, TradeSymbol } from './types';

// ── Limits ──────────────────────────────────────────────────────────────

export const INGEST_MAX_BODY_BYTES = 256 * 1024;
export const INGEST_MAX_TRADES = 100;
export const INGEST_RATE_LIMIT_PER_MIN = 30;

// ── EA payload schemas ──────────────────────────────────────────────────

const eaTradeSchema = z.object({
  ticket: z.string().min(1).max(64),
  symbol: z.string().min(1).max(32),
  side: z.enum(['buy', 'sell']),
  volume: z.number().positive().max(10000),
  entry_time: z.number().int().positive(),
  exit_time: z.number().int().positive(),
  entry_price: z.number().positive(),
  exit_price: z.number().positive(),
  sl: z.number().positive().nullish(),
  tp: z.number().positive().nullish(),
  profit: z.number().finite(),
  commission: z.number().finite().nullish(),
  swap: z.number().finite().nullish(),
  risk_amount: z.number().positive().nullish(),
}).refine((t) => t.exit_time >= t.entry_time, {
  message: 'exit_time must be >= entry_time',
  path: ['exit_time'],
});

export const eaPayloadSchema = z.object({
  ea_version: z.string().min(1).max(32),
  account_login: z.string().min(1).max(64),
  server: z.string().min(1).max(128),
  currency: z.string().min(1).max(8).nullish(),
  trades: z.array(eaTradeSchema).max(INGEST_MAX_TRADES),
});

export type EaTrade = z.infer<typeof eaTradeSchema>;
export type EaPayload = z.infer<typeof eaPayloadSchema>;

export interface RowError {
  index: number;
  field: string;
  message: string;
}

// ── API key helpers ─────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

// ── Symbol normalization ────────────────────────────────────────────────
// MT5 symbols carry broker suffixes (XAUUSD.pro, EURUSDm). Strip them and
// accept only the journal's known symbols; everything else is rejected
// with a per-row error so one exotic symbol never blocks a whole sync.

export function normalizeSymbol(raw: string): TradeSymbol | null {
  const upper = raw.toUpperCase();
  const base = upper.split(/[.\-]/)[0];
  const candidates = [base];
  if (base.endsWith('M') && base.length > 1) candidates.push(base.slice(0, -1));
  for (const c of candidates) {
    if ((TRADE_SYMBOLS as string[]).includes(c)) return c as TradeSymbol;
  }
  return null;
}

// ── Mapping EA trade → trades row ───────────────────────────────────────

export interface MappedTradeRow {
  broker_trade_id: string;
  symbol: TradeSymbol;
  direction: TradeDirection;
  entry_price: number;
  exit_price: number;
  result: TradeResult;
  pnl_amount: number;
  commission: number;
  swap: number;
  sl: number | null;
  tp: number | null;
  volume: number;
  risk_amount: number | null;
  r_multiple: number | null;
  logged_at: string;
  closed_at: string;
  source: 'ea';
}

export function mapEaTrade(trade: EaTrade): MappedTradeRow | RowError {
  const symbol = normalizeSymbol(trade.symbol);
  if (!symbol) {
    return { index: -1, field: 'symbol', message: `unsupported symbol ${trade.symbol}` };
  }

  const commission = trade.commission ?? 0;
  const swap = trade.swap ?? 0;
  const net = Math.round((trade.profit + commission + swap) * 100) / 100;
  const result: TradeResult = net > 0 ? 'win' : net < 0 ? 'loss' : 'breakeven';
  const risk = trade.risk_amount ?? null;
  const rMultiple =
    risk !== null && risk > 0 ? Math.round((net / risk) * 100) / 100 : null;

  return {
    broker_trade_id: trade.ticket,
    symbol,
    direction: trade.side === 'buy' ? 'long' : 'short',
    entry_price: trade.entry_price,
    exit_price: trade.exit_price,
    result,
    pnl_amount: net,
    commission,
    swap,
    sl: trade.sl ?? null,
    tp: trade.tp ?? null,
    volume: trade.volume,
    risk_amount: risk,
    r_multiple: rMultiple,
    logged_at: new Date(trade.entry_time * 1000).toISOString(),
    closed_at: new Date(trade.exit_time * 1000).toISOString(),
    source: 'ea',
  };
}

/** Validate the parsed body: returns the payload plus per-row mapping results. */
export function validateIngestBody(body: unknown): {
  payload: EaPayload;
  rows: MappedTradeRow[];
  errors: RowError[];
} {
  const payload = eaPayloadSchema.parse(body);
  const rows: MappedTradeRow[] = [];
  const errors: RowError[] = [];
  payload.trades.forEach((trade, index) => {
    const mapped = mapEaTrade(trade);
    if ('broker_trade_id' in mapped) {
      rows.push(mapped);
    } else {
      errors.push({ ...mapped, index });
    }
  });
  return { payload, rows, errors };
}
