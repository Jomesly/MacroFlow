import type { AssetSymbol, Direction } from '../types';

export const marketSymbols = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'] as const satisfies readonly AssetSymbol[];

export function isMarketSymbol(value: string): value is AssetSymbol {
  return marketSymbols.some((symbol) => symbol === value);
}

export function directionLabel(direction: Direction): string {
  return direction.replace('weakly_', 'leaning ').replaceAll('_', ' ');
}

export function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}
