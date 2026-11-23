import type { SourceHealth } from './types';

const SPECIAL: Record<string, string> = { fxstreet: 'FXStreet', fx: 'FX' };
const title = (word: string) => SPECIAL[word] ?? word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Names of news feeds that failed on the latest refresh, sorted. A blank
 * (switched-off) feed reports "empty" and is not a failure.
 */
export function failedFeeds(health: SourceHealth | null): string[] {
  if (!health) return [];
  return Object.entries(health)
    .filter(([name, status]) => status === 'failed' && (name === 'finnhub' || name.startsWith('feed_')))
    .map(([name]) => name.replace(/^feed_/, '').split('_').map(title).join(' '))
    .sort((a, b) => a.localeCompare(b));
}
