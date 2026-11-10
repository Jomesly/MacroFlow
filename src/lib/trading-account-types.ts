import { z } from 'zod';

export class TradingAccountError extends Error {
  constructor(message: string, public readonly status: number = 503) { super(message); }
}

export interface TradingAccount {
  id: string;
  brokerName: string | null;
  accountNumber: string | null;
  nickname: string | null;
  server: string | null;
  currency: string | null;
  brokerAccountId: number | null;
  isDefault: boolean;
}

export const accountIdSchema = z.uuid();
export const tradingAccountSchema = z.object({
  brokerName: z.string().trim().min(1, 'Choose or add a broker.').max(80),
  accountNumber: z.string().trim().min(1, 'Enter the account number or ID.').max(64),
  nickname: z.string().trim().max(60).default(''),
  server: z.string().trim().max(128).default(''),
  currency: z.string().regex(/^[A-Z][A-Z0-9]{2,7}$/, 'Choose a currency code such as USD or USDT.'),
}).strict();

export type TradingAccountInput = z.input<typeof tradingAccountSchema>;

/** These are convenience choices, not integrations or broker endorsements. */
export const BROKER_CHOICES = ['IC Markets', 'Pepperstone', 'OANDA', 'Exness', 'XM', 'Interactive Brokers', 'Bybit', 'Binance', 'FTMO'];

export function tradingAccountLabel(account: TradingAccount): string {
  const identity = [account.brokerName, account.accountNumber].filter(Boolean).join(' · ');
  return [account.nickname, identity, account.server === account.brokerName ? null : account.server, account.currency].filter(Boolean).join(' · ') || 'My journal';
}
