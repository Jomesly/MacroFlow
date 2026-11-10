import { describe, expect, it } from 'vitest';
import { formatMoney, moneyUnits, normalizeMoney, unitsMoney } from '../account-money';
import { tradeBatchSchema, normalizeBatch } from '../journal-batch-types';
import { fundsMutationSchema } from '../account-funds-types';

describe('exact account money', () => {
  it('adds tiny crypto amounts and decimal cash without rounding drift', () => {
    expect(unitsMoney(moneyUnits('0.10000001', 'BTC') + moneyUnits('0.00000002', 'BTC'))).toBe('0.10000003');
    expect(unitsMoney(moneyUnits('0.1') + moneyUnits('0.2'))).toBe('0.3');
    expect(normalizeMoney('-0001.23000000', 'USD')).toBe('-1.23');
    expect(normalizeMoney('-0.00')).toBe('0');
  });
  it('enforces denomination precision and bounded, finite decimal inputs', () => {
    for (const invalid of ['NaN', 'Infinity', '1e3', '1,000', '', ' 1', '+1', '1.000000001', '1000000000000000']) expect(() => moneyUnits(invalid)).toThrow();
    expect(() => moneyUnits('1.001', 'USD')).toThrow('2 decimal');
    expect(() => moneyUnits('1.01', 'JPY')).toThrow('0 decimal');
    expect(normalizeMoney('1.001', 'KWD')).toBe('1.001');
  });
  it('formats exact large balances without converting them to floating point', () => {
    expect(formatMoney('999999999999999.12345678', 'BTC')).toBe('999,999,999,999,999.12345678 BTC');
    expect(formatMoney('1000000000000000.01', 'USD')).toBe('1,000,000,000,000,000.01 USD');
    expect(formatMoney('-60', 'USD')).toBe('−60.00 USD');
  });
});

const accountId = '20000000-0000-4000-8000-000000000001';
const batch = () => ({ requestId: crypto.randomUUID(), symbol: 'XAUUSD', direction: 'long', entryPrice: 2000, openedAt: '2026-01-01T10:00:00Z', accounts: [{ accountId }] });
describe('multi-account trade validation', () => {
  it('accepts independent open and closed executions in the same batch', () => {
    const input = { ...batch(), accounts: [{ accountId }, { accountId: '20000000-0000-4000-8000-000000000002', entryPrice: 2001, exitPrice: 2010, closedAt: '2026-01-01T11:00:00Z', netPnl: '250.50' }] };
    const parsed = tradeBatchSchema.parse(input);
    expect(normalizeBatch(parsed).accounts[1].result).toBe('win');
    expect(normalizeBatch(parsed).accounts[0].netPnl).toBeNull();
  });
  it('rejects empty or duplicate destinations', () => {
    expect(tradeBatchSchema.safeParse({ ...batch(), accounts: [] }).success).toBe(false);
    expect(tradeBatchSchema.safeParse({ ...batch(), accounts: [{ accountId }, { accountId }] }).success).toBe(false);
  });
  it('requires trustworthy closing times and consistent cash results', () => {
    for (const execution of [
      { result: 'win' },
      { closedAt: '2025-12-01T10:00:00Z', result: 'win' },
      { closedAt: '2026-01-01T11:00:00Z' },
      { closedAt: '2026-01-01T11:00:00Z', result: 'win', netPnl: '-50' },
    ]) expect(tradeBatchSchema.safeParse({ ...batch(), accounts: [{ accountId, ...execution }] }).success).toBe(false);
  });
  it('keeps explicitly unknown cash results null instead of zero', () => {
    const parsed = tradeBatchSchema.parse({ ...batch(), accounts: [{ accountId, result: 'win', closedAt: '2026-01-01T11:00:00Z', netPnl: null }] });
    expect(normalizeBatch(parsed).accounts[0].netPnl).toBeNull();
    expect(normalizeBatch(parsed).accounts[0].result).toBe('win');
  });
});

describe('audited funding validation', () => {
  const funds = { action: 'add', kind: 'deposit', amount: '200', effectiveAt: '2026-01-02T00:00:00Z' };
  it('accepts a zero opening snapshot, but requires positive cash action amounts', () => {
    expect(fundsMutationSchema.safeParse({ action: 'set-opening', amount: '0', effectiveAt: funds.effectiveAt, expectedVersion: 0 }).success).toBe(true);
    expect(fundsMutationSchema.safeParse(funds).success).toBe(true);
    for (const amount of ['0', '-10']) expect(fundsMutationSchema.safeParse({ ...funds, amount }).success).toBe(false);
  });
  it('requires a reason for adjustments, edits, voids, and opening corrections', () => {
    expect(fundsMutationSchema.safeParse({ ...funds, kind: 'adjustment-increase' }).success).toBe(false);
    expect(fundsMutationSchema.safeParse({ ...funds, action: 'edit', entryId: accountId, expectedVersion: 1, reason: '' }).success).toBe(false);
    expect(fundsMutationSchema.safeParse({ action: 'void', entryId: accountId, expectedVersion: 1, reason: 'duplicate' }).success).toBe(true);
    expect(fundsMutationSchema.safeParse({ action: 'set-opening', amount: '50', effectiveAt: funds.effectiveAt, expectedVersion: 1 }).success).toBe(false);
  });
});
