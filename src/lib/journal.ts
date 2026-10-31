import { supabase } from './supabase';
import { Trade, TradeDirection, TradePatch, TradeResult, TradeSymbol, TRADE_SYMBOLS } from './types';

export class JournalValidationError extends Error {}
export class JournalStorageError extends Error {}

export function computePnlPercent(
  entryPrice: number,
  exitPrice: number,
  direction: TradeDirection
): number {
  const pct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const signed = direction === 'short' ? -pct : pct;
  return Math.round(signed * 100) / 100;
}

function isTradeSymbol(value: unknown): value is TradeSymbol {
  return typeof value === 'string' && (TRADE_SYMBOLS as string[]).includes(value);
}

function isTradeDirection(value: unknown): value is TradeDirection {
  return value === 'long' || value === 'short';
}

function isTradeResult(value: unknown): value is TradeResult {
  return value === 'win' || value === 'loss' || value === 'breakeven';
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// ── Row mapping ───────────────────────────────────────────────────────

interface TradeRow {
  id: string;
  user_id: string | null;
  source: string;
  broker_trade_id: string | null;
  broker_account_id: number | null;
  symbol: string;
  direction: string;
  entry_price: number | string;
  exit_price: number | string | null;
  result: string | null;
  pnl_percent: number | string | null;
  pnl_amount: number | string | null;
  r_multiple: number | string | null;
  setup_tags: string[] | null;
  notes: string | null;
  logged_at: string;
  closed_at: string | null;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    timestamp: row.logged_at,
    closedAt: row.closed_at,
    symbol: row.symbol as TradeSymbol,
    direction: row.direction as TradeDirection,
    entryPrice: Number(row.entry_price),
    exitPrice: toNumber(row.exit_price),
    result: (row.result as TradeResult | null) ?? null,
    pnlPercent: toNumber(row.pnl_percent),
    pnlAmount: toNumber(row.pnl_amount),
    rMultiple: toNumber(row.r_multiple),
    brokerAccountId: row.broker_account_id,
    setupTags: row.setup_tags ?? [],
    notes: row.notes ?? '',
  };
}

function storageError(operation: string, message: string): JournalStorageError {
  return new JournalStorageError(`Failed to ${operation} trade: ${message}`);
}

// ── Validation ────────────────────────────────────────────────────────

interface CreateTradeInput {
  symbol?: unknown;
  direction?: unknown;
  entryPrice?: unknown;
  exitPrice?: unknown;
  result?: unknown;
  setupTags?: unknown;
  notes?: unknown;
}

// ── Public API ────────────────────────────────────────────────────────

export async function createTrade(userId: string, input: CreateTradeInput): Promise<Trade> {
  if (!userId) throw new JournalValidationError('Missing user id');
  if (!isTradeSymbol(input.symbol)) throw new JournalValidationError('Invalid symbol');
  if (!isTradeDirection(input.direction)) throw new JournalValidationError('Invalid direction');
  if (!isPositiveNumber(input.entryPrice)) throw new JournalValidationError('Entry price must be a positive number');

  const exitPrice = input.exitPrice ?? null;
  const result = input.result ?? null;

  if (exitPrice !== null && !isPositiveNumber(exitPrice)) {
    throw new JournalValidationError('Exit price must be a positive number');
  }
  if (exitPrice !== null && result === null) {
    throw new JournalValidationError('Result is required when exit price is set');
  }
  if (result !== null && !isTradeResult(result)) throw new JournalValidationError('Invalid result');
  if (input.setupTags !== undefined && !isStringArray(input.setupTags)) throw new JournalValidationError('Invalid setup tags');
  if (input.notes !== undefined && typeof input.notes !== 'string') throw new JournalValidationError('Invalid notes');

  const trade: Trade = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    closedAt: null,
    symbol: input.symbol,
    direction: input.direction,
    entryPrice: input.entryPrice,
    exitPrice,
    result,
    pnlPercent: exitPrice !== null
      ? computePnlPercent(input.entryPrice, exitPrice, input.direction)
      : null,
    pnlAmount: null,
    rMultiple: null,
    brokerAccountId: null,
    setupTags: input.setupTags ?? [],
    notes: input.notes ?? '',
  };

  const { error } = await supabase.from('trades').insert({
    id: trade.id,
    user_id: userId,
    symbol: trade.symbol,
    direction: trade.direction,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    result: trade.result,
    pnl_percent: trade.pnlPercent,
    setup_tags: trade.setupTags,
    notes: trade.notes,
    logged_at: trade.timestamp,
  });

  if (error) throw storageError('save', error.message);
  return trade;
}

export async function listTrades(userId: string): Promise<Trade[]> {
  if (!userId) throw new JournalValidationError('Missing user id');
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw storageError('list', error.message);
  const rows = (data ?? []) as TradeRow[];
  return rows.map(rowToTrade);
}

export async function updateTrade(userId: string, id: string, patch: TradePatch): Promise<Trade | null> {
  if (!userId) throw new JournalValidationError('Missing user id');
  if (!id) throw new JournalValidationError('Missing trade id');

  const { data: existingRow, error: readError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) throw storageError('read', readError.message);
  if (!existingRow) return null;

  const existing = rowToTrade(existingRow as TradeRow);
  const next: Trade = { ...existing };

  if (patch.entryPrice !== undefined) {
    if (!isPositiveNumber(patch.entryPrice)) throw new JournalValidationError('Entry price must be a positive number');
    next.entryPrice = patch.entryPrice;
  }
  if (patch.exitPrice !== undefined) {
    if (patch.exitPrice !== null && !isPositiveNumber(patch.exitPrice)) {
      throw new JournalValidationError('Exit price must be a positive number');
    }
    next.exitPrice = patch.exitPrice;
  }
  if (patch.result !== undefined) {
    if (patch.result !== null && !isTradeResult(patch.result)) throw new JournalValidationError('Invalid result');
    next.result = patch.result;
  }
  if (patch.setupTags !== undefined) {
    if (!isStringArray(patch.setupTags)) throw new JournalValidationError('Invalid setup tags');
    next.setupTags = patch.setupTags;
  }
  if (patch.notes !== undefined) {
    if (typeof patch.notes !== 'string') throw new JournalValidationError('Invalid notes');
    next.notes = patch.notes;
  }

  if (next.exitPrice !== null && next.result === null) {
    throw new JournalValidationError('Result is required when exit price is set');
  }

  next.pnlPercent = next.exitPrice !== null
    ? computePnlPercent(next.entryPrice, next.exitPrice, next.direction)
    : null;

  const { error: writeError } = await supabase
    .from('trades')
    .update({
      entry_price: next.entryPrice,
      exit_price: next.exitPrice,
      result: next.result,
      pnl_percent: next.pnlPercent,
      setup_tags: next.setupTags,
      notes: next.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId);

  if (writeError) throw storageError('update', writeError.message);
  return next;
}

export async function deleteTrade(userId: string, id: string): Promise<boolean> {
  if (!userId) throw new JournalValidationError('Missing user id');
  if (!id) throw new JournalValidationError('Missing trade id');

  const { data, error } = await supabase
    .from('trades')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (error) throw storageError('delete', error.message);
  return (data?.length ?? 0) > 0;
}
