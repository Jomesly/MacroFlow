'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WeeklyReviewData } from '@/lib/weekly-review';
import type { BucketStats } from '@/lib/analytics';
import { journalFetch } from '@/lib/journal-fetch';

export default function WeeklyReview({ journalAccountId }: { journalAccountId?: string }) {
  const [week, setWeek] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError('');
      setData(null);
      try {
        const q = new URLSearchParams({ week });
        if (journalAccountId) q.set('tradingAccount', journalAccountId);
        const res = await journalFetch(`/api/journal/review?${q}`, { signal });
        if (!res.ok) throw new Error('Weekly review could not be loaded.');
        const body = await res.json();
        if (!signal.aborted) setData(body.review);
      } catch (e) {
        if (!signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load review.');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [week, journalAccountId],
  );
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize loading/results with the selected remote report
    void load(controller.signal);
    return () => controller.abort();
  }, [load, attempt]);
  const totals = data?.analytics.totals;
  const breakdowns: [string, Record<string, BucketStats>][] = data
    ? [
        ['Setups', data.analytics.byTag],
        ['Sessions', data.analytics.bySession],
      ]
    : [];
  return (
    <section
      className="weekly-review space-y-5"
      aria-label="Weekly performance review"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          Week containing
          <input
            aria-label="Week containing"
            type="date"
            required
            value={week}
            onChange={(e) => {
              if (e.target.value) setWeek(e.target.value);
            }}
            className="journal-review-field"
          />
        </label>
      </div>
      <p className="text-sm text-zinc-400">
        Monday–Sunday, UTC. Results use the closing date; session groups use the
        entry time in New York.
      </p>
      {loading && <p role="status">Loading weekly review…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="text-link"
          >
            Retry weekly review
          </button>
        </div>
      )}
      {data && totals && (
        <>
          <h3 className="text-lg font-semibold">Week of {data.start}</h3>
          {!data.moneyComparable && (
            <p role="status">
              Money totals are hidden because trades span multiple accounts.
              Select one account to review its P&amp;L.
            </p>
          )}
          <dl className="review-stats">
            {[
              ['Closed trades', totals.closed],
              [
                'Win rate',
                totals.winRate === null ? '—' : `${totals.winRate}%`,
              ],
              ['Net P&L', totals.net === null ? '—' : totals.net.toFixed(2)],
              [
                'Trades with notes',
                data.notesCoverage === null ? '—' : `${data.notesCoverage}%`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-zinc-400">
            Money metrics cover {totals.moneyCoverage ?? 0}% of closed trades
            and use the broker account currency. Percent-only trades are
            included in counts and win rate. Breakevens are excluded from win
            rate.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {breakdowns.map(([title, rows]) => (
              <div className="context-panel" key={title}>
                <h3>{title}</h3>
                <ul>
                  {Object.entries(rows).map(([name, bucket]) => (
                    <li key={name} className="text-sm mt-2">
                      {name}: {bucket.trades} trades · {bucket.winRate ?? '—'}
                      {bucket.winRate !== null && '%'} win rate
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="context-panel">
            <h3>Review your process</h3>
            <ul className="text-sm space-y-2 mt-3">
              <li>Which setup did you execute consistently?</li>
              <li>Where did you depart from your plan?</li>
              <li>What is one change for next week?</li>
            </ul>
            <p className="text-sm text-zinc-400 mt-3">
              Add observations and screenshots to each trade in History.
            </p>
          </div>
          {!data.trades.length ? (
            <p>No closed trades in this week.</p>
          ) : (
            <ul className="space-y-3">
              {data.trades.map((t) => (
                <li className="context-panel" key={t.id}>
                  <strong>
                    {t.symbol} · {t.result}
                  </strong>
                  <time
                    className="block text-xs text-zinc-400"
                    dateTime={t.closedAt}
                  >
                    {t.dateLabel ?? new Date(t.closedAt).toLocaleString()}
                  </time>
                  <p className="text-sm whitespace-pre-wrap mt-2">
                    {t.notes || 'No review notes yet.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
