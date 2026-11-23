/** How an account's money is marked: "$12.50", "€12.50" or "12.50 BTC". */
export interface MoneyUnit { prefix: string; suffix: string }

const NO_UNIT: MoneyUnit = { prefix: '', suffix: '' };
// Bybit reports USDT accounts as "UST".
const US_DOLLARS = new Set(['USD', 'UST', 'USDT', 'USDC']);

export function moneyUnit(currency: string | null | undefined): MoneyUnit {
  if (!currency) return NO_UNIT;
  if (US_DOLLARS.has(currency)) return { prefix: '$', suffix: '' };
  try {
    const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((part) => part.type === 'currency')?.value;
    if (symbol && symbol !== currency) return { prefix: symbol, suffix: '' };
  } catch {
    // Not an ISO 4217 code; show the code itself.
  }
  return { prefix: '', suffix: ` ${currency}` };
}

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

export function signedMoney(n: number | null, unit: MoneyUnit = NO_UNIT): string {
  if (n === null) return '—';
  const text = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  return `${sign(n)}${unit.prefix}${text}${unit.suffix}`;
}

/** Whole numbers for tight labels; the exact figure stays in the tooltip. */
export function compactMoney(n: number, unit: MoneyUnit = NO_UNIT): string {
  const abs = Math.abs(n);
  if (abs > 0 && abs < 1) return signedMoney(n, unit);
  const text = abs >= 10_000 ? `${(abs / 1000).toFixed(0)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return `${sign(n)}${unit.prefix}${text}${unit.suffix}`;
}
