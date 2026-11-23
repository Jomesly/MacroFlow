import { moneyUnits, unitsMoney } from './account-money';
import type { Trade } from './types';

export type PnlTone = 'positive' | 'negative' | 'flat' | 'none';
export interface PnlLabel { text: string; tone: PnlTone; kind: 'percent' | 'cash' | 'none' }

export const PNL_TONE_CLASS: Record<PnlTone, string> = {
  positive: 'text-emerald-400',
  negative: 'text-red-400',
  flat: 'text-zinc-500',
  none: 'text-zinc-600',
};

const toneOf = (value: number): PnlTone => (value > 0 ? 'positive' : value < 0 ? 'negative' : 'flat');

function exactCash(trade: Pick<Trade, 'pnlAmount' | 'pnlAmountExact'>): string | null {
  const raw = trade.pnlAmountExact ?? (trade.pnlAmount === null ? null : trade.pnlAmount.toFixed(8));
  if (raw == null) return null;
  try {
    return unitsMoney(moneyUnits(raw, undefined, true));
  } catch {
    return trade.pnlAmount === null ? null : unitsMoney(moneyUnits(trade.pnlAmount.toFixed(8), undefined, true));
  }
}

/**
 * Compact P&L for trade lists: the price change when known, otherwise the
 * net cash result (MT5-synced trades record cash only), otherwise a dash.
 */
export function tradePnlLabel(trade: Pick<Trade, 'pnlPercent' | 'pnlAmount' | 'pnlAmountExact'>): PnlLabel {
  if (trade.pnlPercent !== null) {
    return { text: `${trade.pnlPercent > 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%`, tone: toneOf(trade.pnlPercent), kind: 'percent' };
  }
  const cash = exactCash(trade);
  if (cash === null) return { text: '—', tone: 'none', kind: 'none' };
  const negative = cash.startsWith('-');
  const [whole, fraction = ''] = cash.replace(/^-/, '').split('.');
  const amount = `${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
  const tone: PnlTone = negative ? 'negative' : cash === '0' ? 'flat' : 'positive';
  return { text: `${tone === 'negative' ? '−' : tone === 'positive' ? '+' : ''}${amount}`, tone, kind: 'cash' };
}
