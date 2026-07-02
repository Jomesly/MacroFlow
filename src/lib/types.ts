export type AssetSymbol = 'XAUUSD' | 'GBPUSD' | 'US100' | 'DJ30' | 'BTCUSD';

export type Direction = 'bullish' | 'bearish' | 'neutral';

export type Strength = 'strong' | 'moderate' | 'weak';

export type EventCategory =
  | 'central_bank'
  | 'inflation'
  | 'employment'
  | 'gdp'
  | 'pmi'
  | 'retail_sales'
  | 'geopolitical'
  | 'risk_sentiment'
  | 'dollar_strength'
  | 'yields'
  | 'crypto_regulation'
  | 'earnings'
  | 'other';

export type EventImpact = 'high' | 'medium' | 'low';

export interface MacroEvent {
  id: string;
  category: EventCategory;
  title: string;
  description: string;
  timestamp: string;
  impact: EventImpact;
  value: string;
}

export interface BiasRule {
  eventCategory: EventCategory;
  eventValue: string;
  symbol: AssetSymbol;
  scoreChange: number;
}

export interface ScoredEvent {
  id: string;
  category: EventCategory;
  title: string;
  impact: EventImpact;
  scoreChange: number;
}

export interface BiasResult {
  symbol: AssetSymbol;
  name: string;
  biasScore: number;
  biasPercent: number;
  direction: Direction;
  strength: Strength;
  dailyLabel: string;
  drivers: string[];
  events: ScoredEvent[];
  lastUpdated: string;
}

export interface BiasApiResponse {
  data: BiasResult[];
  timestamp: string;
  disclaimer: string;
}

export interface EventsApiResponse {
  events: MacroEvent[];
  timestamp: string;
}
