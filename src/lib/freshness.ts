/** News loses half its weight every six hours; see docs/news-forecast.md. */
export const NEWS_HALF_LIFE_HOURS = 6;
/** Older headlines have mostly been priced in for a four-hour forecast and are dropped. */
export const MAX_HEADLINE_AGE_HOURS = 12;
/** A read without a headline this recent is flagged as leaning on older news. */
export const FRESH_NEWS_HOURS = 6;

/**
 * A headline's scoring weight: direct reporting on the asset starts at full weight,
 * other channels at 80%, and both halve every six hours until the 12-hour cut-off.
 */
export function headlineWeight(ageHours: number, direct: boolean): number {
  if (!(ageHours >= 0 && ageHours < MAX_HEADLINE_AGE_HOURS)) return 0;
  return (direct ? 1 : 0.8) * 0.5 ** (ageHours / NEWS_HALF_LIFE_HOURS);
}

/** Hours between `timestamp` and `now`; NaN when either is not a valid time. */
export function ageHours(timestamp: string, now: string): number {
  return (Date.parse(now) - Date.parse(timestamp)) / 3_600_000;
}

/** "45 min ago", "3 h ago": how old an input is, in words a trader scans quickly. */
export function ageLabel(timestamp: string | undefined, now: string): string {
  const hours = timestamp ? ageHours(timestamp, now) : NaN;
  if (!Number.isFinite(hours)) return 'time unknown';
  const minutes = hours * 60;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  if (hours < 48) return `${Math.floor(hours)} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Share of a headline's original weight that is left after `ageHours`, as a whole percent. */
export function weightLeftPercent(ageHours: number): number {
  return Math.round(100 * 0.5 ** (Math.max(0, ageHours) / NEWS_HALF_LIFE_HOURS));
}
