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

const CATEGORY_CAPS: Partial<Record<MacroEvent['category'], number>> = {
  fed_tone: 40,
  boe_tone: 40,
  dollar_strength: 25,
  yields: 30,
  inflation: 25,
  employment: 20,
  gdp: 20,
  pmi: 20,
  retail_sales: 15,
  risk_sentiment: 30,
  geopolitical: 35,
  crypto_regulation: 40,
  earnings: 25,
};

const COUNTRY_SENSITIVE_CATEGORIES = new Set<MacroEvent['category']>([
  'inflation',
  'employment',
  'gdp',
  'pmi',
  'retail_sales',
]);

const COUNTRY_HOME_SYMBOLS: Partial<Record<AssetSymbol, string>> = {
  US100: 'US',
  DJ30: 'US',
};

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

function normalizeCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const upper = country.toUpperCase();
  if (upper === 'UNITED STATES') return 'US';
  if (upper === 'UNITED KINGDOM') return 'GB';
  return upper;
}

function ruleMatchesEvent(
  rule: (typeof biasRules)[number],
  event: MacroEvent,
  symbol: AssetSymbol
): boolean {
  const eventCountry = normalizeCountry(event.country);
  const ruleCountry = normalizeCountry(rule.country);

  if (ruleCountry) return eventCountry === ruleCountry;

  if (
    symbol === 'GBPUSD' &&
    eventCountry &&
    COUNTRY_SENSITIVE_CATEGORIES.has(event.category)
  ) {
    return false;
  }

  const homeCountry = COUNTRY_HOME_SYMBOLS[symbol];
  if (
    homeCountry &&
    eventCountry &&
    COUNTRY_SENSITIVE_CATEGORIES.has(event.category) &&
    eventCountry !== homeCountry
  ) {
    return false;
  }

  return true;
}

function categoryCap(category: MacroEvent['category']): number {
  return CATEGORY_CAPS[category] ?? 30;
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

function countRulesForSymbol(symbol: AssetSymbol): number {
  return biasRules.filter((r) => r.symbol === symbol).length;
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
    const categoryTotals: Partial<Record<MacroEvent['category'], number>> = {};

    for (const event of events) {
      const matchingRules = biasRules.filter(
        (r) =>
          r.symbol === sym &&
          r.eventCategory === event.category &&
          r.eventValue === event.value &&
          ruleMatchesEvent(r, event, sym)
      );

      for (const rule of matchingRules) {
        const current = categoryTotals[event.category] ?? 0;
        const cappedTotal = clamp(
          current + rule.scoreChange,
          -categoryCap(event.category),
          categoryCap(event.category)
        );
        const appliedScore = cappedTotal - current;

        if (appliedScore === 0) continue;

        totalScore += appliedScore;
        categoryTotals[event.category] = cappedTotal;
        scoredEvents.push({
          id: event.id,
          category: event.category,
          title: event.title,
          description: event.description,
          impact: event.impact,
          scoreChange: appliedScore,
          country: event.country,
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
    const totalPossibleSignals = countRulesForSymbol(sym);

    const conviction = getConviction(
      Math.abs(totalScore),
      totalRelevant,
      highImpactCount,
      confirmationRatio / 100
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
      confidenceCount: totalRelevant,
      totalPossibleSignals,
      history: [],
      lastUpdated: new Date().toISOString(),
    };
  });
}
