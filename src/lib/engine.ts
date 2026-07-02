import {
  AssetSymbol,
  BiasResult,
  Conviction,
  Direction,
  MacroEvent,
  Strength,
  TradeSignal,
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

function getConviction(
  absScore: number,
  eventCount: number,
  highImpactCount: number,
  agreementRatio: number
): Conviction {
  if (absScore > 40 && eventCount >= 3 && highImpactCount >= 1 && agreementRatio >= 0.6) {
    return 'high';
  }
  if (absScore > 25 && eventCount >= 2) {
    return 'medium';
  }
  return 'low';
}

function getSignal(direction: Direction, strength: Strength, conviction: Conviction): TradeSignal {
  if (direction === 'bullish' && strength === 'strong' && conviction === 'high') return 'strong_buy';
  if (direction === 'bullish' && conviction !== 'low') return 'buy';
  if (direction === 'bearish' && strength === 'strong' && conviction === 'high') return 'strong_sell';
  if (direction === 'bearish' && conviction !== 'low') return 'sell';
  return 'neutral';
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
          description: event.description,
          impact: event.impact,
          scoreChange: rule.scoreChange,
          url: event.url,
          sourceName: event.sourceName,
        });
      }
    }

    totalScore = clamp(totalScore, -100, 100);
    const direction = getDirection(totalScore);
    const strength = getStrength(totalScore);

    const bullishCount = scoredEvents.filter((e) => e.scoreChange > 0).length;
    const totalRelevant = scoredEvents.length;
    const agreementRatio = totalRelevant > 0 ? bullishCount / totalRelevant : 0;
    const confirmationRatio = totalRelevant > 0
      ? Math.round((agreementRatio >= 0.5 ? agreementRatio : 1 - agreementRatio) * 100)
      : 0;

    const highImpactCount = scoredEvents.filter((e) => e.impact === 'high').length;

    const conviction = getConviction(
      Math.abs(totalScore),
      totalRelevant,
      highImpactCount,
      agreementRatio
    );

    const signal = getSignal(direction, strength, conviction);

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
      conviction,
      signal,
      dailyLabel: getLabel(totalScore, direction),
      drivers,
      events: scoredEvents,
      confirmationRatio,
      eventCount: totalRelevant,
      lastUpdated: new Date().toISOString(),
    };
  });
}
