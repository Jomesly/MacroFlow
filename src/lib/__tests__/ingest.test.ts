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

  it('rejects unknown symbols', () => {
    expect(normalizeSymbol('EURUSD')).toBeNull();
    expect(normalizeSymbol('GOLD')).toBeNull();
    expect(normalizeSymbol('')).toBeNull();
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
    const mapped = mapEaTrade(eaTrade({ symbol: 'EURUSD' }));
    expect(mapped).toMatchObject({ field: 'symbol' });
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
      trades: [eaTrade(), eaTrade({ ticket: 'x2', symbol: 'EURUSD' })],
    });
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, field: 'symbol' });
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
