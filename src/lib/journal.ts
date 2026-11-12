import { supabase } from './supabase';
import { Trade, TradeDirection, TradePatch, TradeResult, TradeSymbol, TRADE_SYMBOLS } from './types';
import { requireOwnedTradingAccount } from './trading-accounts';
import { journalRpc } from './journal-rpc';
import { moneyUnits, normalizeMoney } from './account-money';
import { TradingAccountError } from './trading-account-types';

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

export interface TradeRow {
  id: string;
  user_id: string | null;
  source: string;
  broker_trade_id: string | null;
  broker_account_id: number | null;
  journal_account_id?: string | null;
  symbol: string;
  direction: string;
  entry_price: number | string | null;
  exit_price: number | string | null;
  result: string | null;
  pnl_percent: number | string | null;
  pnl_amount: number | string | null;
  r_multiple: number | string | null;
  setup_tags: string[] | null;
  notes: string | null;
  logged_at: string;
  closed_at: string | null;
  pnl_amount_exact?: string | null;
  trade_group_id?: string | null;
  revision?: number;
  import_batch_id?: string | null;
  import_source_id?: string | null;
  import_metadata?: Trade['importInfo'];
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    timestamp: row.logged_at,
    closedAt: row.closed_at,
    symbol: row.symbol as TradeSymbol,
    direction: row.direction as TradeDirection,
    entryPrice: toNumber(row.entry_price),
    exitPrice: toNumber(row.exit_price),
    result: (row.result as TradeResult | null) ?? null,
    pnlPercent: toNumber(row.pnl_percent),
    pnlAmount: toNumber(row.pnl_amount),
    pnlAmountExact: row.pnl_amount_exact ?? (row.pnl_amount == null ? null : String(row.pnl_amount)),
    rMultiple: toNumber(row.r_multiple),
    brokerAccountId: row.broker_account_id ?? null,
    journalAccountId: row.journal_account_id ?? null,
    tradeGroupId: row.trade_group_id ?? null,
    revision: row.revision ?? 1,
    importBatchId: row.import_batch_id ?? null,
    importSourceId: row.import_source_id ?? null,
    importInfo: row.import_metadata ?? null,
    setupTags: row.setup_tags ?? [],
    notes: row.notes ?? '',
  };
}

function storageError(operation: string, message: string): JournalStorageError {
  return new JournalStorageError(`Failed to ${operation} trade: ${message}`);
}

// ── Validation ────────────────────────────────────────────────────────

interface CreateTradeInput {
  journalAccountId?: unknown;
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

  const account = input.journalAccountId !== undefined
    ? await requireOwnedTradingAccount(userId, input.journalAccountId) : null;

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
    journalAccountId: account?.id ?? null,
    setupTags: input.setupTags ?? [],
    notes: input.notes ?? '',
  };

  const { error } = await supabase.rpc('run_managed_journal_rpc', { p_user_id: userId, p_operation: 'create_journal_trade', p_arguments: { p_trade_id: trade.id, p_values: {
    id: trade.id,
    user_id: userId,
    ...(account ? { journal_account_id: account.id } : {}),
    symbol: trade.symbol,
    direction: trade.direction,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    result: trade.result,
    pnl_percent: trade.pnlPercent,
    setup_tags: trade.setupTags,
    notes: trade.notes,
    logged_at: trade.timestamp,
  } } });

  if (error) throw storageError('save', error.message);
  return trade;
}

export async function listTrades(userId: string, journalAccountId?: string): Promise<Trade[]> {
  if (!userId) throw new JournalValidationError('Missing user id');
  if (journalAccountId !== undefined) await requireOwnedTradingAccount(userId, journalAccountId);
  const rows: TradeRow[] = [];
  // PostgREST caps each response. Fetch every page before reporting performance.
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from('trades').select('*').eq('user_id', userId);
    if (journalAccountId !== undefined) query = query.eq('journal_account_id', journalAccountId);
    const { data, error } = await query
      .order('logged_at', { ascending: false }).order('created_at', { ascending: false })
      .order('id', { ascending: false }).range(offset, offset + 499);
    if (error) throw storageError('list', error.message);
    const page = (data ?? []) as TradeRow[];
    rows.push(...page);
    if (page.length < 500) break;
  }
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

  if (patch.expectedRevision !== undefined && (!Number.isInteger(patch.expectedRevision) || patch.expectedRevision < 1)) {
    throw new JournalValidationError('Invalid trade revision. Refresh history before saving.');
  }

  if (patch.entryPrice !== undefined) {
    if (!(patch.entryPrice === null && existing.importBatchId) && !isPositiveNumber(patch.entryPrice)) throw new JournalValidationError('Entry price must be a positive number');
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

  if (patch.closedAt !== undefined) {
    if (patch.closedAt !== null && (typeof patch.closedAt !== 'string' || !Number.isFinite(Date.parse(patch.closedAt)) || Date.parse(patch.closedAt) < Date.parse(existing.timestamp) || Date.parse(patch.closedAt) > Date.now() + 60_000)) {
      throw new JournalValidationError('Closing time must be after entry and cannot be in the future.');
    }
    next.closedAt = patch.closedAt;
  }
  if (patch.netPnl !== undefined) {
    if (patch.netPnl !== null && typeof patch.netPnl !== 'string') throw new JournalValidationError('Enter net P&L as a decimal amount.');
    try {
      const account = existing.journalAccountId ? await requireOwnedTradingAccount(userId, existing.journalAccountId) : null;
      if (patch.netPnl !== null && !account?.currency) throw new Error('Set the account currency before recording net P&L.');
      next.pnlAmountExact = patch.netPnl === null ? null : normalizeMoney(patch.netPnl, account!.currency!);
      next.pnlAmount = next.pnlAmountExact === null ? null : Number(next.pnlAmountExact);
    } catch (error) { throw new JournalValidationError(error instanceof Error ? error.message : 'Invalid net P&L.'); }
  }
  if (next.pnlAmountExact != null && (patch.netPnl !== undefined || patch.result !== undefined)) {
    const value = moneyUnits(next.pnlAmountExact);
    const outcome = value > 0n ? 'win' : value < 0n ? 'loss' : 'breakeven';
    if (patch.result != null && patch.result !== outcome) throw new JournalValidationError('Result must match the sign of net P&L.');
    next.result = outcome;
  }
  if (patch.closedAt !== undefined || patch.netPnl !== undefined) {
    if (!next.closedAt && (next.result !== null || next.exitPrice !== null || next.pnlAmountExact != null) && !(existing.importBatchId && !existing.closedAt && next.result === existing.result && next.exitPrice === existing.exitPrice && next.pnlAmountExact === existing.pnlAmountExact)) throw new JournalValidationError('A closed trade needs a closing date and time.');
    if (next.closedAt && !next.result) throw new JournalValidationError('Choose a result or enter net P&L for a closed trade.');
  }
  if (existing.brokerAccountId !== null && (next.entryPrice !== existing.entryPrice || next.exitPrice !== existing.exitPrice || next.result !== existing.result || next.closedAt !== existing.closedAt || next.pnlAmountExact !== existing.pnlAmountExact)) {
    throw new JournalValidationError('MT5 execution details are managed by broker sync. You can edit notes and tags.');
  }

  if (next.exitPrice !== null && next.result === null) {
    throw new JournalValidationError('Result is required when exit price is set');
  }

  next.pnlPercent = next.entryPrice !== null && next.exitPrice !== null
    ? computePnlPercent(next.entryPrice, next.exitPrice, next.direction)
    : null;

  if (patch.expectedRevision !== undefined || existingRow.revision !== undefined) {
    try {
      const row = await journalRpc<TradeRow>('update_journal_trade', { p_user: userId, p_trade: id, p_version: patch.expectedRevision ?? existing.revision, p_payload: {
        entryPrice: next.entryPrice, exitPrice: next.exitPrice, result: next.result, closedAt: next.closedAt,
        netPnl: next.pnlAmountExact ?? null, notes: next.notes, setupTags: next.setupTags,
      } });
      return rowToTrade(row);
    } catch (error) {
      if (error instanceof TradingAccountError && error.status === 400) throw new JournalValidationError(error.message);
      throw error;
    }
  }

  const { error: writeError } = await supabase
    .from('trades')
    .update({
      entry_price: next.entryPrice,
      exit_price: next.exitPrice,
      result: next.result,
      pnl_percent: next.pnlPercent,
      setup_tags: next.setupTags,
      notes: next.notes,
      ...(patch.netPnl !== undefined ? { pnl_amount: next.pnlAmountExact } : {}),
      ...(patch.closedAt !== undefined ? { closed_at: next.closedAt } : {}),
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

  const { data, error } = await supabase.rpc('write_journal_trade', {
    p_user_id: userId, p_action: 'delete', p_trade_id: id,
  });
  if (error) throw storageError('delete', error.message);
  return data !== null;
}
