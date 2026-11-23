import { describe, expect, it } from 'vitest';
import { tradePnlLabel } from '../trade-pnl';

const trade = (pnlPercent: number | null, pnlAmount: number | null, pnlAmountExact?: string | null) =>
  ({ pnlPercent, pnlAmount, pnlAmountExact: pnlAmountExact === undefined ? (pnlAmount === null ? null : String(pnlAmount)) : pnlAmountExact });

describe('tradePnlLabel', () => {
  it('keeps showing the price change for trades that have one', () => {
    expect(tradePnlLabel(trade(1.234, 50))).toEqual({ text: '+1.23%', tone: 'positive', kind: 'percent' });
    expect(tradePnlLabel(trade(-0.456, -20))).toEqual({ text: '-0.46%', tone: 'negative', kind: 'percent' });
    expect(tradePnlLabel(trade(0, 0))).toEqual({ text: '0.00%', tone: 'flat', kind: 'percent' });
  });

  // MT5-synced trades carry net cash P&L but no price change; they showed "—".
  it('shows net cash P&L when a trade has no price change', () => {
    expect(tradePnlLabel(trade(null, -2.09))).toEqual({ text: '−2.09', tone: 'negative', kind: 'cash' });
    expect(tradePnlLabel(trade(null, -0.28))).toEqual({ text: '−0.28', tone: 'negative', kind: 'cash' });
    expect(tradePnlLabel(trade(null, 125.5))).toEqual({ text: '+125.50', tone: 'positive', kind: 'cash' });
    expect(tradePnlLabel(trade(null, 1234.5))).toEqual({ text: '+1,234.50', tone: 'positive', kind: 'cash' });
    expect(tradePnlLabel(trade(null, 0))).toEqual({ text: '0.00', tone: 'flat', kind: 'cash' });
  });

  it('keeps exact decimals beyond cents and survives float noise', () => {
    expect(tradePnlLabel(trade(null, 0.00012345, '0.00012345'))).toEqual({ text: '+0.00012345', tone: 'positive', kind: 'cash' });
    expect(tradePnlLabel(trade(null, 0.1 + 0.2, null))).toEqual({ text: '+0.30', tone: 'positive', kind: 'cash' });
  });

  it('shows a dash when neither result is known', () => {
    expect(tradePnlLabel(trade(null, null))).toEqual({ text: '—', tone: 'none', kind: 'none' });
  });
});
