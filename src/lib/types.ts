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
  | 'yen_strength'
  | 'asset_sentiment'
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

export type EvidenceType = 'headline' | 'surprise' | 'trend' | 'market';

export interface MacroContext {
  asOf: string;
  regime: 'rates_sensitive' | 'growth_sensitive' | 'mixed' | 'unknown';
  rateSpread: number | null;
  rateObservationDate: string | null;
  inflation: 'accelerating' | 'cooling' | 'stable' | 'unknown';
  growth: 'expanding' | 'contracting' | 'unknown';
  labor: 'improving' | 'weakening' | 'mixed' | 'unknown';
  complete: boolean;
  reasons: string[];
}

export interface AlignmentAssessment {
  modelVersion: string;
  horizonHours: 4;
  status: 'aligned' | 'conflicted' | 'unconfirmed' | 'insufficient_evidence';
  marketConfirmation?: 'confirming' | 'opposing' | 'flat' | 'missing';
  reasons: string[];
  context: MacroContext;
  /** Rule alignment is not an estimated win probability. */
  probability: null;
  validation: 'unvalidated';
}

export interface MacroEvent {
  id: string;
  category: EventCategory;
  title: string;
  description: string;
  timestamp: string;
  impact: EventImpact;
  value: string;
  /** Direct asset narratives must never spill into unrelated markets. */
  symbol?: AssetSymbol;
  country?: string;
  url?: string;
  sourceName?: string;
  evidenceType?: EvidenceType;
  /** Underlying series/release identity; newer observations replace older ones. */
  seriesId?: string;
  observationDate?: string;
  expiresAt?: string;
  /** Exact release evidence retained for prospective audits; never infer consensus retrospectively. */
  releaseEvidence?: { actual: number; estimate: number; consensusFirstSeenAt: string; releasedAt: string };
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
  /** Rule contribution before category caps and the final score cap. */
  scoreChange: number;
  country?: string;
  url?: string;
  sourceName?: string;
  evidenceType?: EvidenceType;
  timestamp?: string;
  observationDate?: string;
}

export interface BiasResult {
  symbol: AssetSymbol;
  name: string;
  biasScore: number;
  /** Signed macro bias strength on a -100% to +100% scale; not a calibrated win probability. */
  biasPercent: number;
  /** Audit trail for the normalized percentage, before the legacy +/-100 raw-score cap. */
  scoring?: { netPoints: number; maxPoints: number; categoryPoints: Partial<Record<EventCategory, number>> };
  probability?: import('./probability/types').ProbabilityEstimate;
  direction: Direction;
  strength: Strength;
  conviction: Conviction;
  signal: TradeSignal;
  dailyLabel: string;
  drivers: string[];
  events: ScoredEvent[];
  /** Percentage of scored events supporting the net score; zero for a zero score. */
  confirmationRatio: number;
  eventCount: number;
  /** Distinct categories with a nonzero net contribution. */
  confidenceCount: number;
  /** Distinct rule categories available for this asset. */
  totalPossibleSignals: number;
  history: HistoryEntry[];
  lastUpdated: string;
  alignment?: AlignmentAssessment;
  forecast?: {
    modelVersion: string;
    horizonHours: 4;
    issuedAt: string;
    expiresAt: string;
    basis: 'news' | 'mixed' | 'macro' | 'unavailable';
    summary: string;
    limitations: string[];
    sourceCount: number;
    latestEvidenceAt: string | null;
    macroBiasScore: number;
    probability: null;
  };
}

export interface DxyContext {
  price: string;
  percentChange: number;
  status: 'strengthening' | 'weakening';
  summary: string;
}

export type CalendarImpact = 'high' | 'medium' | 'low' | 'holiday';

/** One scheduled release from the economic calendar, times in ISO UTC. */
export interface CalendarEvent {
  id: string;
  title: string;
  currency: string;
  time: string;
  impact: CalendarImpact;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  affects: string[];
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
