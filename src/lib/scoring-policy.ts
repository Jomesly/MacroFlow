/** Explicit research policies. Live callers omit this argument and keep current behavior. */
export interface ScoringPolicy {
  id: string;
  scale: 'category-capacity' | 'fixed-100';
  activitySigns: 'regime' | 'reference';
  trendWeight: 0.5 | 1;
  economicHeadlines: boolean;
}

export const CURRENT_SCORING: Readonly<ScoringPolicy> = Object.freeze({
  id: 'current-repair', scale: 'category-capacity', activitySigns: 'regime', trendWeight: 0.5, economicHeadlines: false,
});

/** Frozen before the outcome comparison; no result-driven tuning. */
export const RESEARCH_POLICIES: Readonly<Record<string, Readonly<ScoringPolicy>>> = Object.freeze({
  currentRepair: CURRENT_SCORING,
  referenceScale: Object.freeze({ ...CURRENT_SCORING, id: 'reference-scale', scale: 'fixed-100' }),
  referenceSigns: Object.freeze({ ...CURRENT_SCORING, id: 'reference-signs', activitySigns: 'reference' }),
  fullTrendWeight: Object.freeze({ ...CURRENT_SCORING, id: 'full-trend-weight', trendWeight: 1 }),
  economicHeadlines: Object.freeze({ ...CURRENT_SCORING, id: 'economic-headlines', economicHeadlines: true }),
  restoration: Object.freeze({ ...CURRENT_SCORING, id: 'restoration-v1', scale: 'fixed-100', activitySigns: 'reference' }),
});
