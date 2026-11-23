import { describe, expect, it } from 'vitest';
import { compactMoney, moneyUnit, signedMoney } from '../money-format';

describe('moneyUnit', () => {
  it('uses a dollar sign for US dollars and dollar stablecoins', () => {
    for (const currency of ['USD', 'UST', 'USDT', 'USDC']) expect(moneyUnit(currency)).toEqual({ prefix: '$', suffix: '' });
  });

  it('uses the currency symbol when one exists', () => {
    expect(moneyUnit('EUR')).toEqual({ prefix: '€', suffix: '' });
    expect(moneyUnit('GBP')).toEqual({ prefix: '£', suffix: '' });
  });

  it('falls back to the currency code for symbol-less currencies', () => {
    expect(moneyUnit('BTC')).toEqual({ prefix: '', suffix: ' BTC' });
  });

  it('adds nothing when the currency is unknown', () => {
    expect(moneyUnit(null)).toEqual({ prefix: '', suffix: '' });
  });
});

describe('signedMoney', () => {
  const usd = moneyUnit('UST');
  it('puts the sign before the dollar sign', () => {
    expect(signedMoney(-4.77, usd)).toBe('−$4.77');
    expect(signedMoney(12.5, usd)).toBe('+$12.50');
    expect(signedMoney(-2385.5, usd)).toBe('−$2,385.50');
    expect(signedMoney(0, usd)).toBe('$0.00');
  });

  it('keeps a dash for unknown amounts', () => {
    expect(signedMoney(null, usd)).toBe('—');
  });

  it('suffixes codes and leaves unitless amounts as before', () => {
    expect(signedMoney(-0.0012, moneyUnit('BTC'))).toBe('−0.0012 BTC');
    expect(signedMoney(-4.77, moneyUnit(null))).toBe('−4.77');
  });
});

describe('compactMoney', () => {
  const usd = moneyUnit('USD');
  it('rounds tight labels and keeps the dollar sign', () => {
    expect(compactMoney(-4.77, usd)).toBe('−$5');
    expect(compactMoney(1234, usd)).toBe('+$1.2k');
    expect(compactMoney(25000, usd)).toBe('+$25k');
    expect(compactMoney(-0.28, usd)).toBe('−$0.28');
    expect(compactMoney(0, usd)).toBe('$0');
  });
});
