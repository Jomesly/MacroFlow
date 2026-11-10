import {
  AssetSymbol,
  BiasResult,
  Conviction,
  Direction,
  MacroEvent,
  MacroContext,
  Strength,
  TradeSignal,
  ScoredEvent,
} from './types';
import { biasRules } from './rules';
import { HIGH_CONVICTION_PERCENT } from './bias-reading';
import { CURRENT_SCORING, type ScoringPolicy } from './scoring-policy';
export { HIGH_CONVICTION_PERCENT } from './bias-reading';

// ── Rate-regime types and helpers ──────────────────────────────────

export type RateRegime = 'cutting' | 'neutral';

/**
 * Threshold below which the DGS2-FEDFUNDS spread signals "cuts priced in".
 *
 * Historical context:
 *   - In cutting cycles (2001, 2007-2008, 2019-2020, 2024-2025), this spread
 *     typically sits between -0.50 and -2.00.
 *   - In hiking cycles (2004-2006, 2022-2023), it's near zero or positive.
 *   - -0.50 is conservative — it captures clear-cutting expectations without
 *     triggering on normal market noise.
 */
const CUTTING_REGIME_THRESHOLD = -0.50;

/**
 * Determine the rate-expectations regime from the DGS2-FEDFUNDS spread.
 *
 * @param spread DGS2 minus FEDFUNDS in percentage points, or null if unavailable.
 *   When null, defaults to 'neutral' (no modulation).
 */
export function getRateRegime(spread: number | null): RateRegime {
  if (spread === null) return 'neutral';
  return spread < CUTTING_REGIME_THRESHOLD ? 'cutting' : 'neutral';
}

/**
 * Employment modulation multiplier for equity-like assets in the cutting regime.
 *
 * In a "cuts priced in" environment:
 *   - Weak employment → was bearish for equities, now bullish (reinforces cut hopes)
 *   - Strong employment → was bullish for equities, now bearish (threatens cut narrative)
 *   - For XAUUSD/BTCUSD: employment matters less — dampen by 50%
 *
 * Returns a multiplier to apply to the rule's scoreChange.
 *   1.0  = no change (neutral regime or unrelated category)
 *   -1.0 = flip direction (equity symbols in cutting regime)
 *   0.5  = dampen by 50% (gold/crypto in cutting regime)
 */
function getEmploymentModulation(
  symbol: AssetSymbol,
  eventValue: string,
  regime: RateRegime
): number {
  if (regime === 'neutral') return 1.0;

  if (symbol === 'US100' || symbol === 'DJ30' || symbol === 'US500') {
    // Flip: weak → bullish, strong → bearish
    return (eventValue === 'weak' || eventValue === 'strong') ? -1.0 : 1.0;
  }

  if (symbol === 'XAUUSD' || symbol === 'BTCUSD') {
    // Dampen: employment matters less when cuts are priced in
    return 0.5;
  }

  return 1.0;
}

// ── Existing engine constants and functions ────────────────────────

const CATEGORY_CAPS: Partial<Record<MacroEvent['category'], number>> = {
  fed_tone: 40,
  boe_tone: 40,
  ecb_tone: 40,
  boj_tone: 40,
  snb_tone: 40,
  rba_tone: 40,
  boc_tone: 40,
  rbnz_tone: 40,
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

function macroModulation(symbol: AssetSymbol, event: MacroEvent, context: MacroContext): number {
  if ((symbol === 'US100' || symbol === 'DJ30' || symbol === 'US500') && ['employment', 'gdp', 'pmi', 'retail_sales'].includes(event.category)) {
    if (context.regime === 'rates_sensitive') return -1;
    if (context.regime === 'growth_sensitive') return 1;
    return 0; // Unresolved growth/rate channels must not manufacture direction.
  }
  return 1;
}

function ruleValue(event: MacroEvent): string {
  if (event.evidenceType !== 'trend') return event.value;
  const mapping: Record<string, string> = {
    accelerating: 'high', cooling: 'low', improving: 'strong', weakening: 'weak',
    expanding: 'beat', contracting: 'miss',
  };
  return mapping[event.value] ?? 'neutral';
}

const COUNTRY_SENSITIVE_CATEGORIES = new Set<MacroEvent['category']>([
  'inflation',
  'employment',
  'gdp',
  'pmi',
  'retail_sales',
]);

const COUNTRY_HOME_SYMBOLS: Partial<Record<AssetSymbol, string>> = {
  XAUUSD: 'US',
  US100: 'US',
  DJ30: 'US',
  BTCUSD: 'US',
  US500: 'US',
};

/** Currency pairs have two economies, so macro data only counts once its country is known. */
const TWO_LEG_SYMBOLS = new Set<AssetSymbol>([
  'GBPUSD', 'EURUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
]);

export const ASSET_NAMES: Record<AssetSymbol, string> = {
  XAUUSD: 'Gold',
  GBPUSD: 'British Pound / US Dollar',
  US100: 'Nasdaq 100',
  DJ30: 'Dow Jones 30',
  BTCUSD: 'Bitcoin',
  US500: 'S&P 500',
  EURUSD: 'Euro / US Dollar',
  USDJPY: 'US Dollar / Japanese Yen',
  USDCHF: 'US Dollar / Swiss Franc',
  AUDUSD: 'Australian Dollar / US Dollar',
  USDCAD: 'US Dollar / Canadian Dollar',
  NZDUSD: 'New Zealand Dollar / US Dollar',
};

export const ALL_SYMBOLS: AssetSymbol[] = [
  'XAUUSD',
  'GBPUSD',
  'US100',
  'DJ30',
  'BTCUSD',
  'US500',
  'EURUSD',
  'USDJPY',
  'USDCHF',
  'AUDUSD',
  'USDCAD',
  'NZDUSD',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const upper = country.toUpperCase();
  if (upper === 'UNITED STATES') return 'US';
  if (upper === 'UNITED KINGDOM' || upper === 'UK') return 'GB';
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

  if (TWO_LEG_SYMBOLS.has(symbol) && COUNTRY_SENSITIVE_CATEGORIES.has(event.category)) {
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

/** Aggregate before capping; scoring and evidence confirmation must use the same units. */
export function cappedCategoryPoints(events: Pick<ScoredEvent, 'category' | 'scoreChange'>[]): Map<MacroEvent['category'], number> {
  const totals = new Map<MacroEvent['category'], number>();
  for (const event of events) totals.set(event.category, (totals.get(event.category) ?? 0) + event.scoreChange);
  return new Map([...totals].map(([category, score]) => [category, clamp(score, -categoryCap(category), categoryCap(category))]));
}

function getDirection(score: number): Direction {
  if (score > 50) return 'bullish';
  if (score >= 15) return 'weakly_bullish';
  if (score >= -14) return 'neutral';
  if (score >= -50) return 'weakly_bearish';
  return 'bearish';
}

function getStrength(score: number): Strength {
  const abs = Math.abs(score);
  if (abs > 50) return 'strong';
  if (abs > 25) return 'moderate';
  return 'weak';
}

function getConviction(
  displayedMagnitude: number,
  supportingCategoryCount: number,
  supportingHighImpactCount: number,
  agreementRatio: number
): Conviction {
  if (displayedMagnitude >= HIGH_CONVICTION_PERCENT && supportingCategoryCount >= 3 && supportingHighImpactCount >= 1 && agreementRatio >= 0.6) {
    return 'high';
  }
  if (displayedMagnitude > 25 && supportingCategoryCount >= 2 && supportingHighImpactCount >= 1 && agreementRatio > 0.5) {
    return 'medium';
  }
  return 'low';
}

function getSignal(direction: Direction, strength: Strength, conviction: Conviction): TradeSignal {
  if (direction === 'bullish' && strength === 'strong' && conviction === 'high') return 'strong_buy';
  if (direction === 'bullish' && conviction !== 'low') return 'buy';
  if (direction === 'weakly_bullish' && conviction !== 'low') return 'buy';
  if (direction === 'bearish' && strength === 'strong' && conviction === 'high') return 'strong_sell';
  if (direction === 'bearish' && conviction !== 'low') return 'sell';
  if (direction === 'weakly_bearish' && conviction !== 'low') return 'sell';
  return 'neutral';
}

/** Most points one direction can reach for a market: the sum of its rule categories' caps. */
export function maxBiasPoints(symbol: AssetSymbol): number {
  const categories = new Set(biasRules.filter((r) => r.symbol === symbol).map((r) => r.eventCategory));
  return [...categories].reduce((sum, category) => sum + categoryCap(category), 0);
}

function countCategoriesForSymbol(symbol: AssetSymbol): number {
  return new Set(biasRules.filter((r) => r.symbol === symbol).map((r) => r.eventCategory)).size;
}

function getLabel(score: number, direction: Direction): string {
  if (direction === 'neutral') return 'Neutral Today';
  if (direction === 'weakly_bullish') return 'Leaning Bullish Today';
  if (direction === 'weakly_bearish') return 'Leaning Bearish Today';
  const strength = getStrength(score);
  const prefix = strength === 'strong' ? 'Strongly' : '';
  const dir = direction === 'bullish' ? 'Bullish' : 'Bearish';
  return [prefix, dir, 'Today'].filter(Boolean).join(' ');
}

export function calculateBias(
  events: MacroEvent[],
  symbol?: AssetSymbol,
  rateSpread?: number | MacroContext | null,
  policy: Readonly<ScoringPolicy> = CURRENT_SCORING
): BiasResult[] {
  const symbols = symbol ? [symbol] : ALL_SYMBOLS;
  const context = typeof rateSpread === 'object' && rateSpread !== null ? rateSpread : null;
  const regime = getRateRegime(typeof rateSpread === 'number' ? rateSpread : null);

  return symbols.map((sym) => {
    let totalScore = 0;
    const scoredEvents: BiasResult['events'] = [];
    const categoryTotals: Partial<Record<MacroEvent['category'], number>> = {};
    const seenEvents = new Set<string>();
    const seenArticles = new Set<string>();

    for (const event of events) {
      const signalKey = `${event.category}:${event.value}:${normalizeCountry(event.country) ?? ''}`;
      const eventKey = `${event.id}:${signalKey}`;
      const articleKey = event.url ? `${event.url}:${event.timestamp.slice(0, 10)}:${signalKey}` : undefined;
      if (seenEvents.has(eventKey) || (articleKey && seenArticles.has(articleKey))) continue;
      seenEvents.add(eventKey);
      if (articleKey) seenArticles.add(articleKey);
      const matchingRules = biasRules.filter(
        (r) =>
          r.symbol === sym &&
          r.eventCategory === event.category &&
          r.eventValue === ruleValue(event) &&
          ruleMatchesEvent(r, event, sym)
      );

      for (const rule of matchingRules) {
        // Apply regime modulation to employment category only
        const modulation = context ? (policy.activitySigns === 'reference' ? 1 : macroModulation(sym, event, context)) : event.category === 'employment'
          ? getEmploymentModulation(sym, event.value, regime)
          : 1.0;

        const weight = event.evidenceType === 'trend' ? policy.trendWeight : 1;
        const modulatedScore = Math.sign(rule.scoreChange * modulation) * Math.round(Math.abs(rule.scoreChange * modulation * weight));

        if (modulatedScore === 0) continue;
        categoryTotals[event.category] = (categoryTotals[event.category] ?? 0) + modulatedScore;
        scoredEvents.push({
          id: event.id,
          category: event.category,
          title: event.title,
          description: event.description,
          impact: event.impact,
          // Preserve the rule input so opposing evidence remains visible.
          // Category and final score caps are applied after aggregation.
          scoreChange: modulatedScore,
          country: event.country,
          url: event.url,
          sourceName: event.sourceName,
          evidenceType: event.evidenceType ?? 'headline',
          timestamp: event.timestamp,
          observationDate: event.observationDate,
        });
      }
    }

    const categoryPoints = cappedCategoryPoints(scoredEvents);
    totalScore = [...categoryPoints.values()].reduce((sum, score) => sum + score, 0);
    // Live default: share of category capacity. Research may explicitly restore the
    // fixed reference point scale. Neither scale is an outcome probability.
    const maxPoints = policy.scale === 'fixed-100' ? 100 : maxBiasPoints(sym);
    const biasPercent = maxPoints > 0 ? clamp(Math.round((100 * totalScore) / maxPoints), -100, 100) : 0;
    const scoring = { netPoints: totalScore, maxPoints, categoryPoints: Object.fromEntries(categoryPoints) };
    totalScore = clamp(totalScore, -100, 100);
    const direction = getDirection(totalScore);
    const strength = getStrength(totalScore);

    const totalRelevant = scoredEvents.length;
    const supportingEvents = scoredEvents.filter((e) => e.scoreChange * totalScore > 0);
    const agreementRatio = totalRelevant > 0 ? supportingEvents.length / totalRelevant : 0;
    const confirmationRatio = Math.round(agreementRatio * 100);
    const supportingCategories = new Set(
      Object.entries(categoryTotals).filter(([, score]) => score * totalScore > 0).map(([category]) => category)
    );
    const highImpactCount = supportingEvents.filter((e) => e.impact === 'high' && supportingCategories.has(e.category)).length;
    const totalPossibleSignals = countCategoriesForSymbol(sym);

    const conviction = getConviction(
      Math.abs(biasPercent),
      supportingCategories.size,
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
      biasPercent,
      scoring,
      direction,
      strength,
      conviction,
      signal,
      dailyLabel: getLabel(totalScore, direction),
      drivers,
      events: scoredEvents,
      confirmationRatio,
      eventCount: totalRelevant,
      confidenceCount: Object.values(categoryTotals).filter((score) => score !== 0).length,
      totalPossibleSignals,
      history: [],
      lastUpdated: new Date().toISOString(),
    };
  });
}
