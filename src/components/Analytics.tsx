'use client';
import { journalFetch } from '@/lib/journal-fetch';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsResult, CalendarDay } from '@/lib/analytics';
import DayTradesPanel from '@/components/journal/DayTradesPanel';
import { journalFeatures } from '@/lib/journal-features';
import { TRADE_SYMBOLS } from '@/lib/types';
import {
  Breakdown,
  CountUp,
  DailyBars,
  EquityCurve,
  MonthCalendar,
  Sparkline,
  TimeHeatmap,
  fmtMoney,
  fmtPct,
  toneOf,
} from '@/components/journal/AnalyticsCharts';
import { moneyUnit } from '@/lib/money-format';
import { formatTradeOutcomes } from '@/lib/trade-outcomes';

const LABEL = 'block text-xs font-medium text-zinc-400 mb-2';
const FIELD =
  'w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 transition-colors';

type Range = 'all' | '7d' | '30d' | '90d' | 'ytd' | 'custom';
const RANGES: { value: Exclude<Range, 'custom'>; label: string; title: string }[] = [
  { value: '7d', label: '7 days', title: 'Last 7 days' },
  { value: '30d', label: '30 days', title: 'Last 30 days' },
  { value: '90d', label: '90 days', title: 'Last 90 days' },
  { value: 'ytd', label: 'This year', title: 'Year to date' },
  { value: 'all', label: 'All time', title: 'All time' },
];

/** First day of a preset range, in UTC to match the reporting dates. */
function rangeStart(range: Exclude<Range, 'custom'>): string {
  const now = new Date();
  if (range === 'all') return '';
  if (range === 'ytd') return `${now.getUTCFullYear()}-01-01`;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range];
  return new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

const fmtRatio = (n: number) => n.toFixed(2);
const fmtRate = (n: number) => fmtPct(Math.round(n * 10) / 10);

export default function Analytics({ journalAccountId }: { journalAccountId?: string }) {
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moneyComparable, setMoneyComparable] = useState(true);
  const [currency, setCurrency] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [range, setRange] = useState<Range>('all');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const requestVersion = useRef(0);
  // One query string for the summary and the day drill-down, so both agree.
  const filters = useMemo(() => {
    const q = new URLSearchParams();
    if (journalAccountId) q.set('tradingAccount', journalAccountId);
    if (symbolFilter) q.set('symbol', symbolFilter);
    if (fromFilter) q.set('from', fromFilter);
    if (toFilter) q.set('to', toFilter);
    return q.toString();
  }, [journalAccountId, symbolFilter, fromFilter, toFilter]);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const aRes = await journalFetch(`/api/journal/analytics?${filters}`);
      if (!aRes.ok) throw new Error(`HTTP ${aRes.status}`);
      const aJson = await aRes.json();
      if (version !== requestVersion.current) return;
      setData(aJson.analytics);
      setMoneyComparable(aJson.moneyComparable !== false);
      setCurrency(aJson.currency ?? null);
      setError('');
    } catch (err) {
      if (version !== requestVersion.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load analytics. Please retry.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; all setState occurs after await resolves
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  if (loading && !data) return <p className="text-sm text-zinc-500">Loading analytics…</p>;
  if (error && !data) return <div role="alert" className="space-y-3 text-sm"><p className="text-red-400">{error}</p><button onClick={() => void load()} className="text-blue-400 underline">Try again</button></div>;
  if (!data) return null;

  const t = data.totals;
  // Cash figures carry the account's currency, e.g. "$" for USD and USDT ("UST") accounts.
  const unit = moneyUnit(currency);
  const money = (n: number | null) => fmtMoney(n, unit);
  const flatDays = data.equity.length - (t.winningDays ?? 0) - (t.losingDays ?? 0);
  const unknownEntries = data.byWeekday['Unknown entry time']?.trades ?? 0;
  const streak = t.currentStreak;
  const widest = Math.max(t.avgWin ?? 0, Math.abs(t.avgLoss ?? 0)) || 1;
  const outcomes = formatTradeOutcomes(t.wins, t.losses, t.breakeven);

  return (
    <div className="jd max-w-6xl" aria-busy={loading}>
      {!moneyComparable && <p role="status" className="text-sm text-zinc-400">Cash totals are hidden because these trades span multiple accounts. Select one trading account above to review its P&amp;L.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          The latest figures could not be loaded ({error}). <button onClick={() => void load()} className="text-blue-400 underline">Try again</button>
        </p>
      )}

      <div className="jd-toolbar">
        <div className="jd-field">
          <label htmlFor="flt-symbol" className={LABEL}>Symbol</label>
          <select id="flt-symbol" value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} className={FIELD}>
            <option value="">All symbols</option>
            {TRADE_SYMBOLS.map((symbol) => <option key={symbol}>{symbol}</option>)}
          </select>
        </div>
        <div className="jd-field">
          <label htmlFor="flt-from" className={LABEL}>From</label>
          <input id="flt-from" type="date" value={fromFilter} onChange={(e) => { setFromFilter(e.target.value); setRange('custom'); }} className={FIELD} />
        </div>
        <div className="jd-field">
          <label htmlFor="flt-to" className={LABEL}>To</label>
          <input id="flt-to" type="date" value={toFilter} onChange={(e) => { setToFilter(e.target.value); setRange('custom'); }} className={FIELD} />
        </div>
        <div className="market-filters" role="group" aria-label="Date range">
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              title={item.title}
              aria-label={item.title}
              aria-pressed={range === item.value}
              onClick={() => { setRange(item.value); setFromFilter(rangeStart(item.value)); setToFilter(''); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="jd-kpis">
        <div className="jd-tile">
          <p className="jd-label">Profit or loss{currency ? ` · ${currency}` : ''}</p>
          <div className="jd-tile-body">
            <span className={`jd-value is-${toneOf(t.net)}`}>
              {t.net === null ? '—' : <CountUp value={t.net} format={money} />}
            </span>
            <Sparkline points={data.equity} />
          </div>
          <p className="jd-sub">
            {!moneyComparable ? 'Select one account to see your total' : t.moneyCoverage === null || t.moneyCoverage === 0 ? 'No cash results yet' : t.moneyCoverage < 100 ? `Cash result recorded for ${t.moneyCoverage}% of closed trades` : 'From closed trades'}
          </p>
        </div>
        <div className="jd-tile">
          <p className="jd-label">Closed trades</p>
          <div className="jd-tile-body"><span className="jd-value">{t.closed}</span></div>
          <p className="jd-sub">{t.open > 0 ? `${t.open} ${t.open === 1 ? 'trade is' : 'trades are'} still open` : 'Completed trades in this period'}</p>
        </div>
        <div className="jd-tile">
          <p className="jd-label">Win rate</p>
          <div className="jd-tile-body">
            <span className="jd-value">{t.winRate === null ? '—' : <CountUp value={t.winRate} format={fmtRate} />}</span>
          </div>
          <p className="jd-sub">{outcomes}</p>
          {t.breakeven > 0 && <p className="jd-sub">Break-even trades are left out of the win rate.</p>}
        </div>
      </div>

      {t.trades === 0 ? (
        <div className="jd-panel">
          <p className="jd-empty">No trades in this view yet. Log a trade, or widen the date range and symbol to see your results here.</p>
        </div>
      ) : (
        <>
          <section className="jd-panel jd-calendar-panel">
            <MonthCalendar days={data.calendar} unit={unit} onSelectDay={setSelectedDay} selectedDate={selectedDay?.date} />
            <p className="jd-sub mt-3">Select a day to see its trades{journalFeatures.screenshots ? ' and screenshots' : ''}. Dates use UTC.</p>
          </section>
          {selectedDay && <DayTradesPanel key={`${selectedDay.date}:${filters}`} day={selectedDay} filters={filters} unit={unit} onClose={() => setSelectedDay(null)} />}

          <details className="jd-details">
            <summary>More details</summary>
            <div className="jd-details-body">
              <div className="jd-kpis">
                <div className="jd-tile">
                  <p className="jd-label">Profit factor</p>
                  <span className="jd-value">{t.profitFactor === null ? '—' : <CountUp value={t.profitFactor} format={fmtRatio} />}</span>
                  <p className="jd-sub">{t.grossProfit === null ? 'Needs cash results' : `${money(t.grossProfit)} won · ${money(t.grossLoss)} lost`}</p>
                </div>
                <div className="jd-tile">
                  <p className="jd-label">Winning days</p>
                  <span className="jd-value">{t.dayWinRate === null ? '—' : <CountUp value={t.dayWinRate} format={fmtRate} />}</span>
                  <p className="jd-sub">{t.winningDays === null ? 'Needs cash results' : `${t.winningDays} winning · ${t.losingDays} losing${flatDays ? ` · ${flatDays} break-even` : ''}`}</p>
                </div>
                <div className="jd-tile">
                  <p className="jd-label">Average win / average loss</p>
                  <span className="jd-value">{t.winLossRatio === null ? '—' : <CountUp value={t.winLossRatio} format={fmtRatio} />}</span>
                  <div className="jd-ratio">
                    <div className="is-positive"><i style={{ width: `${((t.avgWin ?? 0) / widest) * 100}%` }} /><span>{money(t.avgWin)}</span></div>
                    <div className="is-negative"><i style={{ width: `${(Math.abs(t.avgLoss ?? 0) / widest) * 100}%` }} /><span>{money(t.avgLoss)}</span></div>
                  </div>
                </div>
              </div>
              <dl className="jd-strip">
                <div><dt>Average result per trade</dt><dd className={`is-${toneOf(t.expectancy)}`}>{money(t.expectancy)}</dd></div>
                <div><dt>Average return on risk{t.rCoverage !== null && t.rCoverage < 100 ? ` (${t.rCoverage}% of closed)` : ''}</dt><dd>{t.avgR !== null ? `${t.avgR > 0 ? '+' : ''}${t.avgR.toFixed(2)}R` : '—'}</dd></div>
                <div><dt>Largest drop at daily close</dt><dd className={`is-${toneOf(t.maxDrawdown)}`}>{money(t.maxDrawdown)}</dd></div>
                <div><dt>Best day</dt><dd className={`is-${toneOf(t.bestDay?.net ?? null)}`}>{money(t.bestDay?.net ?? null)}</dd></div>
                <div><dt>Worst day</dt><dd className={`is-${toneOf(t.worstDay?.net ?? null)}`}>{money(t.worstDay?.net ?? null)}</dd></div>
                <div>
                  <dt>Current run</dt>
                  <dd className={streak ? (streak.result === 'win' ? 'is-positive' : 'is-negative') : ''}>
                    {streak ? `${streak.count} ${streak.result === 'win' ? (streak.count === 1 ? 'win' : 'wins') : streak.count === 1 ? 'loss' : 'losses'}` : '—'}
                  </dd>
                </div>
                <div><dt>Longest winning run</dt><dd>{t.longestWinStreak} {t.longestWinStreak === 1 ? 'win' : 'wins'}</dd></div>
                <div><dt>Longest losing run</dt><dd>{t.longestLossStreak} {t.longestLossStreak === 1 ? 'loss' : 'losses'}</dd></div>
              </dl>
              <div className="jd-row">
                <section className="jd-panel">
                  <div className="jd-panel-head"><h3>Profit over time</h3><span>By close date</span></div>
                  {data.equity.length ? <EquityCurve points={data.equity} unit={unit} /> : <p className="jd-empty">The curve appears once closed trades have a cash result{moneyComparable ? '' : ' in a single account'}.</p>}
                </section>
                <section className="jd-panel">
                  <div className="jd-panel-head"><h3>Daily profit or loss</h3><span>Last {Math.min(30, data.equity.length)} trading {data.equity.length === 1 ? 'day' : 'days'}</span></div>
                  {data.equity.length ? <DailyBars points={data.equity} unit={unit} /> : <p className="jd-empty">Daily results appear with your first closed cash trade.</p>}
                </section>
              </div>
              <section className="jd-panel">
                <div className="jd-panel-head"><h3>Win rate by entry time</h3><span>New York time</span></div>
                {data.timeHeatmap.length ? <TimeHeatmap cells={data.timeHeatmap} unit={unit} /> : <p className="jd-empty">Appears once closed trades have an entry time.</p>}
                {unknownEntries > 0 && <p className="jd-sub mt-3">{unknownEntries} {unknownEntries === 1 ? 'trade has' : 'trades have'} no entry time and {unknownEntries === 1 ? 'is' : 'are'} left out.</p>}
              </section>
              <div className="jd-row jd-row-even">
                <Breakdown title="By symbol" data={data.bySymbol} unit={unit} />
                <Breakdown title="By setup tag" data={data.byTag} unit={unit} />
                <Breakdown title="By session" data={data.bySession} unit={unit} />
                <Breakdown title="By weekday" data={data.byWeekday} unit={unit} />
              </div>
              <p className="jd-note">Metrics count account trade records; a shared entry contributes once for each account. Deposits and withdrawals are excluded from trading profit or loss. Reporting dates use UTC; entry times use New York time. When the close date is unknown, daily results use the recorded trade date. The largest drop uses daily closing totals and excludes changes within the day.</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
