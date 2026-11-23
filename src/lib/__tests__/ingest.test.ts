import { describe, expect, it } from 'vitest';
import {
  EaTrade,
  hashApiKey,
  keyPrefix,
  mapEaTrade,
  normalizeSymbol,
  validateIngestBody,
} from '../ingest';

function eaTrade(overrides: Partial<EaTrade> = {}): EaTrade {
  return {
    ticket: '987654',
    symbol: 'XAUUSD',
    side: 'buy',
    volume: 0.1,
    entry_time: 1760400000,
    exit_time: 1760403600,
    entry_price: 3950.12,
    exit_price: 3962.4,
    sl: 3945.0,
    tp: 3975.0,
    profit: 122.8,
    commission: -0.7,
    swap: 0,
    ...overrides,
  };
}

describe('normalizeSymbol', () => {
  it('accepts plain symbols', () => {
    expect(normalizeSymbol('XAUUSD')).toBe('XAUUSD');
    expect(normalizeSymbol('us100')).toBe('US100');
  });

  it('strips broker dot suffixes', () => {
    expect(normalizeSymbol('XAUUSD.pro')).toBe('XAUUSD');
    expect(normalizeSymbol('BTCUSD.m')).toBe('BTCUSD');
  });

  it('strips trailing m suffixes', () => {
    expect(normalizeSymbol('XAUUSDm')).toBe('XAUUSD');
  });

  // Every market on the dashboard must be journal-able: USDCAD was rejected
  // outright even before its broker suffix was considered.
  it.each([
    ['XAUUSD', 'XAUUSD'], ['GBPUSD', 'GBPUSD'], ['US100', 'US100'], ['DJ30', 'DJ30'],
    ['BTCUSD', 'BTCUSD'], ['US500', 'US500'], ['EURUSD', 'EURUSD'], ['USDJPY', 'USDJPY'],
    ['USDCHF', 'USDCHF'], ['AUDUSD', 'AUDUSD'], ['USDCAD', 'USDCAD'], ['NZDUSD', 'NZDUSD'],
  ])('accepts dashboard market %s', (raw, want) => {
    expect(normalizeSymbol(raw)).toBe(want);
  });

  it.each([
    ['USDCAD+', 'USDCAD'], // Bybit
    ['XAUUSD+', 'XAUUSD'], // Bybit gold
    ['EURUSD+', 'EURUSD'],
    ['GBPUSD#', 'GBPUSD'],
    ['AUDUSD_i', 'AUDUSD'],
    ['NZDUSD-ECN', 'NZDUSD'],
    ['USDJPY.r', 'USDJPY'],
    ['USDCHFm', 'USDCHF'], // Exness standard
    ['EURUSDc', 'EURUSD'], // Exness cent
    ['XAUUSDpro', 'XAUUSD'],
    ['#US500', 'US500'],
  ])('strips broker decoration from %s', (raw, want) => {
    expect(normalizeSymbol(raw)).toBe(want);
  });

  it.each([
    ['SPX500', 'US500'],
    ['SP500', 'US500'],
    ['US500.cash', 'US500'],
    ['NAS100', 'US100'],
    ['USTEC', 'US100'],
    ['NDX100', 'US100'],
    ['US100Cash', 'US100'],
    ['US30', 'DJ30'],
    ['DJI30', 'DJ30'],
    ['WS30', 'DJ30'],
    ['GOLD', 'XAUUSD'],
    ['BTCUSDT', 'BTCUSD'],
    ['EUR/USD', 'EURUSD'],
    ['XAU_USD', 'XAUUSD'],
  ])('maps broker name %s to its market', (raw, want) => {
    expect(normalizeSymbol(raw)).toBe(want);
  });

  // A wrong market is worse than a rejected row: these must not be guessed.
  it.each([
    ['EURGBP'], // pair MacroFlow does not cover
    ['XAUEUR'], // gold priced in euros
    ['GOLDEUR'],
    ['US30Y'], // 30-year Treasury yield, not the Dow
    ['US2000'], // Russell 2000
    [''],
    ['+'],
  ])('rejects %s', (raw) => {
    expect(normalizeSymbol(raw)).toBeNull();
  });
});

describe('mapEaTrade', () => {
  it('maps a winning buy with net P&L and R multiple', () => {
    const mapped = mapEaTrade(eaTrade({ profit: 122.8, commission: -0.7, swap: 0, risk_amount: 50 }));
    expect('broker_trade_id' in mapped).toBe(true);
    if (!('broker_trade_id' in mapped)) return;

    expect(mapped.direction).toBe('long');
    expect(mapped.symbol).toBe('XAUUSD');
    expect(mapped.pnl_amount).toBe(122.1); // 122.8 - 0.7 + 0
    expect(mapped.result).toBe('win');
    expect(mapped.r_multiple).toBe(2.44); // 122.1 / 50
    expect(mapped.logged_at).toBe(new Date(1760400000 * 1000).toISOString());
    expect(mapped.closed_at).toBe(new Date(1760403600 * 1000).toISOString());
    expect(mapped.source).toBe('ea');
  });

  it('maps sell to short and losses correctly', () => {
    const mapped = mapEaTrade(eaTrade({ side: 'sell', profit: -40, commission: 0, swap: 0 }));
    if (!('broker_trade_id' in mapped)) throw new Error('expected mapped row');
    expect(mapped.direction).toBe('short');
    expect(mapped.result).toBe('loss');
    expect(mapped.r_multiple).toBeNull(); // no risk_amount
  });

  it('derives breakeven on zero net', () => {
    const mapped = mapEaTrade(eaTrade({ profit: 0.7, commission: -0.7 }));
    if (!('broker_trade_id' in mapped)) throw new Error('expected mapped row');
    expect(mapped.result).toBe('breakeven');
  });

  it('returns a row error for unsupported symbols', () => {
    const mapped = mapEaTrade(eaTrade({ symbol: 'EURGBP' }));
    expect(mapped).toMatchObject({ field: 'symbol', message: 'unsupported symbol EURGBP' });
  });
});

describe('validateIngestBody', () => {
  it('accepts a valid payload with heartbeat', () => {
    const { payload, rows, errors } = validateIngestBody({
      ea_version: '1.0',
      account_login: '123',
      server: 'Test-Server',
      trades: [],
    });
    expect(payload.account_login).toBe('123');
    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('keeps valid rows and reports bad rows without throwing', () => {
    const { rows, errors } = validateIngestBody({
      ea_version: '1.0',
      account_login: '123',
      server: 'Test-Server',
      trades: [eaTrade(), eaTrade({ ticket: 'x2', symbol: 'EURGBP' })],
    });
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, field: 'symbol' });
  });

  // Regression: a Bybit MT5 account's two USDCAD+ shorts were rejected on
  // every sync with "unsupported symbol USDCAD+". Synthetic tickets/login;
  // prices, side and volume mirror the real deals (EA v1.2 sends position side).
  it('ingests Bybit USDCAD+ shorts as USDCAD', () => {
    const { rows, errors } = validateIngestBody({
      ea_version: '1.2',
      account_login: '1000001',
      server: 'Bybit-Live-7',
      currency: 'USD',
      trades: [
        eaTrade({
          ticket: '900002', symbol: 'USDCAD+', side: 'sell', volume: 0.2,
          entry_time: Date.UTC(2026, 10, 23, 0, 25, 17) / 1000, exit_time: Date.UTC(2026, 10, 23, 0, 27, 25) / 1000,
          entry_price: 1.43368, exit_price: 1.4337, sl: null, tp: null,
          profit: -0.28, commission: 0, swap: 0, risk_amount: null,
        }),
        eaTrade({
          ticket: '900001', symbol: 'USDCAD+', side: 'sell', volume: 0.2,
          entry_time: Date.UTC(2026, 10, 23, 0, 17, 10) / 1000, exit_time: Date.UTC(2026, 10, 23, 0, 20, 24) / 1000,
          entry_price: 1.43375, exit_price: 1.4339, sl: null, tp: null,
          profit: -2.09, commission: 0, swap: 0, risk_amount: null,
        }),
      ],
    });
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.broker_trade_id, r.symbol, r.direction, r.result, r.pnl_amount])).toEqual([
      ['900002', 'USDCAD', 'short', 'loss', -0.28],
      ['900001', 'USDCAD', 'short', 'loss', -2.09],
    ]);
  });

  it('rejects oversized batches and bad shapes', () => {
    expect(() =>
      validateIngestBody({
        ea_version: '1.0',
        account_login: '123',
        server: 's',
        trades: Array.from({ length: 101 }, () => eaTrade()),
      })
    ).toThrow();

    expect(() =>
      validateIngestBody({
        ea_version: '1.0',
        account_login: '123',
        server: 's',
        trades: [eaTrade({ exit_time: 100, entry_time: 200 })],
      })
    ).toThrow();
  });
});

describe('API key hashing', () => {
  it('hashes deterministically and prefixes for display', () => {
    expect(hashApiKey('mf_abc')).toBe(hashApiKey('mf_abc'));
    expect(hashApiKey('mf_abc')).toHaveLength(64);
    expect(hashApiKey('mf_abc')).not.toContain('mf_abc');
    expect(keyPrefix('mf_abcdefgh')).toBe('mf_abcde');
  });
});
