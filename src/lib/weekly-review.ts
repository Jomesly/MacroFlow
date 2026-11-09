import { computeAnalytics } from './analytics';
import type { Trade } from './types';

export function weekStart(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a valid date');
  const day = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    throw new Error('Use a valid date');
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function computeWeeklyReview(
  trades: Trade[],
  date: string,
  accountId?: number,
) {
  const start = weekStart(date);
  const end = new Date(
    Date.parse(`${start}T00:00:00Z`) + 7 * 86_400_000,
  ).toISOString();
  const fromMs = Date.parse(`${start}T00:00:00Z`),
    toMs = Date.parse(end);
  // Performance belongs to the week of closing, including trades opened earlier.
  const closed = trades.filter(
    (t) =>
      t.result !== null &&
      (accountId === undefined || t.brokerAccountId === accountId) &&
      Date.parse(t.closedAt ?? t.timestamp) >= fromMs &&
      Date.parse(t.closedAt ?? t.timestamp) < toMs,
  );
  const moneyAccounts = new Set(
    closed.filter((t) => t.pnlAmount !== null).map((t) => t.brokerAccountId),
  );
  // Different accounts can use different currencies; never silently sum them.
  const moneyComparable = moneyAccounts.size <= 1;
  const analytics = computeAnalytics(
    moneyComparable ? closed : closed.map((t) => ({ ...t, pnlAmount: null })),
  );
  return {
    start,
    end: end.slice(0, 10),
    moneyComparable,
    analytics,
    notesCoverage: closed.length
      ? Math.round(
          (closed.filter((t) => t.notes.trim()).length / closed.length) * 100,
        )
      : null,
    tagCoverage: closed.length
      ? Math.round(
          (closed.filter((t) => t.setupTags.length).length / closed.length) *
            100,
        )
      : null,
    trades: closed.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      result: t.result,
      closedAt: t.closedAt ?? t.timestamp,
      notes: t.notes,
      setupTags: t.setupTags,
    })),
  };
}

export type WeeklyReviewData = ReturnType<typeof computeWeeklyReview>;
