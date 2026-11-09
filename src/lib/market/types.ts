export type ResourceStatus = 'fresh' | 'stale' | 'empty' | 'unavailable';

export interface ResourceMeta {
  provider: string;
  instrumentId: string;
  sourceUrl: string;
  observedAt: string | null;
  fetchedAt: string | null;
  freshUntil: string | null;
  staleUntil: string | null;
  status: ResourceStatus;
  delayed: boolean;
}

export interface Resource<T> {
  data: T | null;
  meta: ResourceMeta;
}

export interface CalendarEvent {
  id: string;
  title: string;
  currency: 'USD' | 'GBP';
  date: string;
  impact: 'high' | 'medium' | 'low' | 'holiday';
  forecast: string | null;
  previous: string | null;
  actual: null;
  affects: import('../types').AssetSymbol[];
  sourceName?: string;
  sourceUrl?: string;
}

export interface CalendarData {
  events: CalendarEvent[];
  windowStart: string | null;
  windowEnd: string | null;
  sources?: { name: string; url: string; status: ResourceStatus; fetchedAt: string | null }[];
}

export interface MacroReading {
  value: number;
  changePercent?: number;
  unit: 'index' | 'percent' | 'basis-points';
}

export interface MacroContextData {
  dxy: Resource<MacroReading>;
  treasury2y: Resource<MacroReading>;
  treasury10y: Resource<MacroReading>;
  spread: Resource<MacroReading>;
  vix: Resource<MacroReading>;
}
