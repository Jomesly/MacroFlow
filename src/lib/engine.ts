import {
  AssetSymbol,
  BiasResult,
  Direction,
  MacroEvent,
  Strength,
} from './types';
import { biasRules } from './rules';

export const ASSET_NAMES: Record<AssetSymbol, string> = {
  XAUUSD: 'Gold',
  GBPUSD: 'British Pound / US Dollar',
  US100: 'Nasdaq 100',
  DJ30: 'Dow Jones 30',
  BTCUSD: 'Bitcoin',
};

export const ALL_SYMBOLS: AssetSymbol[] = [
  'XAUUSD',
  'GBPUSD',
  'US100',
  'DJ30',
  'BTCUSD',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function absPercent(score: number): number {
  return Math.round(Math.abs(score));
}

function getDirection(score: number): Direction {
  if (score > 25) return 'bullish';
  if (score < -25) return 'bearish';
  return 'neutral';
}

function getStrength(score: number): Strength {
  const abs = Math.abs(score);
  if (abs > 50) return 'strong';
  if (abs > 25) return 'moderate';
  return 'weak';
}

function getLabel(score: number, direction: Direction): string {
  if (direction === 'neutral') return 'Neutral Today';
  const strength = getStrength(score);
  const prefix = strength === 'strong' ? 'Strongly' : '';
  const dir = direction === 'bullish' ? 'Bullish' : 'Bearish';
  return [prefix, dir, 'Today'].filter(Boolean).join(' ');
}

export function calculateBias(
  events: MacroEvent[],
  symbol?: AssetSymbol
): BiasResult[] {
  const symbols = symbol ? [symbol] : ALL_SYMBOLS;

  return symbols.map((sym) => {
    let totalScore = 0;
    const scoredEvents: BiasResult['events'] = [];

    for (const event of events) {
      const matchingRules = biasRules.filter(
        (r) =>
          r.symbol === sym &&
          r.eventCategory === event.category &&
          r.eventValue === event.value
      );

      for (const rule of matchingRules) {
        totalScore += rule.scoreChange;
        scoredEvents.push({
          id: event.id,
          category: event.category,
          title: event.title,
          impact: event.impact,
          scoreChange: rule.scoreChange,
        });
      }
    }

    totalScore = clamp(totalScore, -100, 100);
    const direction = getDirection(totalScore);
    const strength = getStrength(totalScore);

    const drivers = scoredEvents.map((e) => {
      const prefix =
        e.scoreChange > 0
          ? 'Bullish'
          : e.scoreChange < 0
            ? 'Bearish'
            : 'Neutral';
      return `${prefix}: ${e.title}`;
    });

    return {
      symbol: sym,
      name: ASSET_NAMES[sym],
      biasScore: totalScore,
      biasPercent: totalScore >= 0 ? absPercent(totalScore) : -absPercent(totalScore),
      direction,
      strength,
      dailyLabel: getLabel(totalScore, direction),
      drivers,
      events: scoredEvents,
      lastUpdated: new Date().toISOString(),
    };
  });
}
