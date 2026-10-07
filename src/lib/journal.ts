import { Redis } from '@upstash/redis';
import { Trade, TradeDirection, TradePatch, TradeResult, TradeSymbol, TRADE_SYMBOLS } from './types';

const TRADE_IDS_KEY = 'macroflow:journal:trade_ids';
const TRADE_KEY_PREFIX = 'macroflow:journal:trade:';

export class JournalValidationError extends Error {}
export class JournalStorageError extends Error {}

function createClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function requireClient(): Redis {
  const redis = createClient();
  if (!redis) throw new JournalStorageError('Journal storage is not configured');
  return redis;
}

function tradeKey(id: string): string {
  return `${TRADE_KEY_PREFIX}${id}`;
}

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

interface CreateTradeInput {
  symbol?: unknown;
  direction?: unknown;
  entryPrice?: unknown;
  exitPrice?: unknown;
  result?: unknown;
  setupTags?: unknown;
  notes?: unknown;
}

export async function createTrade(input: CreateTradeInput): Promise<Trade> {
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
    symbol: input.symbol,
    direction: input.direction,
    entryPrice: input.entryPrice,
    exitPrice,
    result,
    pnlPercent: exitPrice !== null
      ? computePnlPercent(input.entryPrice, exitPrice, input.direction)
      : null,
    setupTags: input.setupTags ?? [],
    notes: input.notes ?? '',
  };

  const redis = requireClient();
  await redis.set(tradeKey(trade.id), trade);
  await redis.lpush(TRADE_IDS_KEY, trade.id);

  return trade;
}

export async function listTrades(): Promise<Trade[]> {
  const redis = requireClient();
  const ids = await redis.lrange<string>(TRADE_IDS_KEY, 0, -1);
  if (ids.length === 0) return [];

  const values = await redis.mget(...ids.map(tradeKey));

  const trades: Trade[] = [];
  for (const value of values) {
    if (value == null) continue;
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (parsed && typeof parsed === 'object' && 'id' in parsed) {
        trades.push(parsed as Trade);
      }
    } catch {
      // skip corrupt entries rather than failing the whole list
    }
  }
  return trades;
}

export async function updateTrade(id: string, patch: TradePatch): Promise<Trade | null> {
  if (!id) throw new JournalValidationError('Missing trade id');

  const redis = requireClient();
  const existing = await redis.get<Trade>(tradeKey(id));
  if (!existing) return null;

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

  await redis.set(tradeKey(id), next);
  return next;
}

export async function deleteTrade(id: string): Promise<boolean> {
  if (!id) throw new JournalValidationError('Missing trade id');

  const redis = requireClient();
  const existing = await redis.get<Trade>(tradeKey(id));
  await redis.del(tradeKey(id));
  await redis.lrem(TRADE_IDS_KEY, 0, id);

  return existing !== null;
}
