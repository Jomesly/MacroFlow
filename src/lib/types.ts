export type AssetSymbol =
  | 'XAUUSD' | 'GBPUSD' | 'US100' | 'DJ30' | 'BTCUSD'
  | 'US500' | 'EURUSD' | 'USDJPY' | 'USDCHF' | 'AUDUSD' | 'USDCAD' | 'NZDUSD';

export type Direction = 'bullish' | 'weakly_bullish' | 'neutral' | 'weakly_bearish' | 'bearish';

export type Strength = 'strong' | 'moderate' | 'weak';

export type Conviction = 'high' | 'medium' | 'low';

export type TradeSignal = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';

export type EventCategory =
  | 'fed_tone'
  | 'boe_tone'
  | 'ecb_tone'
  | 'boj_tone'
  | 'snb_tone'
  | 'rba_tone'
  | 'boc_tone'
  | 'rbnz_tone'
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
  calendarStatus?: import('./market/types').ResourceStatus;
  sourceHealth?: SourceHealth;
  stale?: boolean;
}

export interface EventsApiResponse {
  events: MacroEvent[];
  timestamp: string;
  source: DataSource;
}

// ── Trading Journal ─────────────────────────────────────────────────

export type TradeSymbol = 'XAUUSD' | 'GBPUSD' | 'US100' | 'DJ30' | 'BTCUSD';

export type TradeDirection = 'long' | 'short';

export type TradeResult = 'win' | 'loss' | 'breakeven';

export const TRADE_SYMBOLS: TradeSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];

export const SETUP_TAGS = ['Sweep', 'IFVG', 'Fib', 'Asian Range'];

export interface Trade {
  id: string;
  timestamp: string;
  closedAt: string | null;
  symbol: TradeSymbol;
  direction: TradeDirection;
  entryPrice: number | null;
  exitPrice: number | null;
  result: TradeResult | null;
  pnlPercent: number | null;
  pnlAmount: number | null;
  /** Exact decimal for editing money; legacy numeric value remains for analytics. */
  pnlAmountExact?: string | null;
  rMultiple: number | null;
  brokerAccountId: number | null;
  journalAccountId?: string | null;
  tradeGroupId?: string | null;
  revision?: number;
  importBatchId?: string | null;
  importSourceId?: string | null;
  importInfo?: { dateMeaning: 'entry' | 'close'; datePrecision: 'date' | 'time'; closedPrecision: 'date' | 'time' | null; sourceDate: string; timezone: string; sourceClosedDate: string | null } | null;
  setupTags: string[];
  notes: string;
}

export interface TradePatch {
  entryPrice?: number | null;
  exitPrice?: number | null;
  result?: TradeResult | null;
  setupTags?: string[];
  notes?: string;
  netPnl?: string | null;
  closedAt?: string | null;
  expectedRevision?: number;
}

export interface TradeApiResponse {
  trade: Trade;
}

export interface TradesApiResponse {
  trades: Trade[];
  timestamp: string;
}
