export type AssetSymbol = 'XAUUSD' | 'GBPUSD' | 'US100' | 'DJ30' | 'BTCUSD';

export type Direction = 'bullish' | 'bearish' | 'neutral';

export type Strength = 'strong' | 'moderate' | 'weak';

export type Conviction = 'high' | 'medium' | 'low';

export type TradeSignal = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';

export type EventCategory =
  | 'fed_tone'
  | 'boe_tone'
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

export type DataSource = 'live' | 'hybrid' | 'baseline';

export interface MacroEvent {
  id: string;
  category: EventCategory;
  title: string;
  description: string;
  timestamp: string;
  impact: EventImpact;
  value: string;
  country?: string;
  url?: string;
  sourceName?: string;
}

export interface BiasRule {
  eventCategory: EventCategory;
  eventValue: string;
  symbol: AssetSymbol;
  scoreChange: number;
  country?: string;
}

export type SourceStatus = 'ok' | 'empty' | 'failed';

export type SourceHealth = Record<string, SourceStatus>;

export interface ScoredEvent {
  id: string;
  category: EventCategory;
  title: string;
  description: string;
  impact: EventImpact;
  scoreChange: number;
  country?: string;
  url?: string;
  sourceName?: string;
}

export interface BiasResult {
  symbol: AssetSymbol;
  name: string;
  biasScore: number;
  biasPercent: number;
  direction: Direction;
  strength: Strength;
  conviction: Conviction;
  signal: TradeSignal;
  dailyLabel: string;
  drivers: string[];
  events: ScoredEvent[];
  confirmationRatio: number;
  eventCount: number;
  confidenceCount: number;
  totalPossibleSignals: number;
  history: HistoryEntry[];
  lastUpdated: string;
}

export interface DxyContext {
  price: string;
  percentChange: number;
  status: 'strengthening' | 'weakening';
  summary: string;
}

export interface UpcomingEvent {
  name: string;
  country: string;
  date: string;
  impact: 'high' | 'medium';
  affects: string[];
}

export interface HistoryEntry {
  date: string;
  direction: Direction;
  biasScore: number;
}

export interface BiasApiResponse {
  data: BiasResult[];
  timestamp: string;
  source: DataSource;
  disclaimer: string;
  dxy?: DxyContext;
  nextEvent?: UpcomingEvent | null;
  sourceHealth?: SourceHealth;
}

export interface EventsApiResponse {
  events: MacroEvent[];
  timestamp: string;
  source: DataSource;
}
