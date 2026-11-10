import { describe, expect, it } from 'vitest';
import { tradingAccountLabel, tradingAccountSchema, type TradingAccount } from '../trading-account-types';

describe('trading account identity', () => {
  it('preserves leading zeros and alphanumeric IDs while trimming names', () => {
    const parsed = tradingAccountSchema.parse({ brokerName: ' Bybit ', accountNumber: ' 00abc62 ', nickname: ' London ', currency: 'USD' });
    expect(parsed).toMatchObject({ brokerName: 'Bybit', accountNumber: '00abc62', nickname: 'London' });
  });
  it('requires broker and account ID even when a nickname is supplied', () => {
    expect(tradingAccountSchema.safeParse({ brokerName: '', accountNumber: '', nickname: 'My account', currency: 'USD' }).success).toBe(false);
    expect(tradingAccountSchema.safeParse({ brokerName: 'Broker', accountNumber: 12345, currency: 'USD' }).success).toBe(false);
  });
  it('does not accept ownership or connection fields from the browser', () => {
    expect(tradingAccountSchema.safeParse({ brokerName: 'Broker', accountNumber: '123', currency: 'USD', user_id: 'someone-else' }).success).toBe(false);
  });
  it('keeps broker identity visible alongside a nickname', () => {
    const account: TradingAccount = { id: 'id', brokerName: 'Bybit', accountNumber: '00abc62', nickname: 'Practice', server: null, currency: 'USD', brokerAccountId: null, isDefault: false };
    expect(tradingAccountLabel(account)).toBe('Practice · Bybit · 00abc62 · USD');
    expect(tradingAccountLabel({ ...account, nickname: null, server: 'Demo02' })).toBe('Bybit · 00abc62 · Demo02 · USD');
  });
});
