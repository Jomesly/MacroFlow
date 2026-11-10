/** Exact decimal amounts shared by forms and server validation. No float sums. */
const SCALE = 100_000_000n;
const LIMIT = 999_999_999_999_999n * SCALE + SCALE - 1n;
const CRYPTO = new Set(['BTC', 'ETH', 'USDT', 'USDC']);

export function currencyPrecision(currency: string): number {
  if (CRYPTO.has(currency)) return 8;
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

export function moneyUnits(value: string, currency?: string, aggregate = false): bigint {
  if (!(aggregate ? /^-?\d{1,40}(?:\.\d{1,8})?$/ : /^-?\d{1,15}(?:\.\d{1,8})?$/).test(value)) throw new Error('Use a decimal amount with up to 15 whole digits and 8 decimal places.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  if (currency && fraction.replace(/0+$/, '').length > currencyPrecision(currency)) {
    throw new Error(`${currency} supports ${currencyPrecision(currency)} decimal places.`);
  }
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
  if (!aggregate && units > LIMIT) throw new Error('Amount is outside the supported range.');
  return negative ? -units : units;
}

export function unitsMoney(units: bigint): string {
  const abs = units < 0n ? -units : units;
  const fraction = (abs % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return `${units < 0n ? '-' : ''}${abs / SCALE}${fraction ? `.${fraction}` : ''}`;
}

export function normalizeMoney(value: string, currency?: string): string {
  return unitsMoney(moneyUnits(value, currency));
}

export function formatMoney(value: string, currency: string): string {
  const normalized = unitsMoney(moneyUnits(value, undefined, true));
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const decimals = Math.max(CRYPTO.has(currency) ? 2 : currencyPrecision(currency), fraction.length);
  const grouped = BigInt(whole).toLocaleString('en-US');
  return `${normalized.startsWith('-') ? '−' : ''}${grouped}${decimals ? `.${fraction.padEnd(decimals, '0')}` : ''} ${currency}`;
}

export function localDateTime(date = new Date(), seconds = false): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, seconds ? 19 : 16);
}

export function isoDateTime(value: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Enter a valid date and time.');
  return date.toISOString();
}
