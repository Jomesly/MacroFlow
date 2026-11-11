'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence } from 'motion/react';
import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarBlank,
  CaretDown,
  CheckCircle,
  Clock,
  Info,
  WarningCircle,
} from '@phosphor-icons/react';
import type {
  BiasApiResponse,
  DataSource,
  SourceHealth,
  UpcomingEvent,
} from '@/lib/types';
import MarketCard from '@/components/MarketCard';
import { packBoard } from '@/lib/market-board';
import { consistentBiasReading } from '@/lib/bias-reading';
import WeeklyEconomicCalendar from '@/components/calendar/EconomicCalendar';
import MarketBreadth from '@/components/MarketBreadth';
import Disclaimer from '@/components/Disclaimer';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import EconomicCalendar from '@/components/market/EconomicCalendar';
import MacroContext from '@/components/market/MacroContext';
import PanelErrorBoundary from '@/components/market/PanelErrorBoundary';
import { marketFeatures } from '@/lib/market/features';
import { useMarketClock } from '@/components/market/useMarketClock';

type Filter = 'all' | 'bullish' | 'bearish' | 'neutral';
const SOURCE_LABELS: Record<DataSource, string> = {
  live: 'Live data',
  hybrid: 'Live + baseline',
  baseline: 'Baseline data',
};

function RefreshTime({ timestamp }: { timestamp: string | null }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    if (!timestamp) return;
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil(
          (5 * 60 * 1000 - (Date.now() - Date.parse(timestamp))) / 1000,
        ),
      );
      setTime(
        `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`,
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  return (
    <span className="refresh-time">
      <Clock size={14} aria-hidden="true" />
      {timestamp ? `Next update ${time}` : 'Waiting for first update'}
    </span>
  );
}

function SourceStatus({ health }: { health: SourceHealth | null }) {
  return (
    <details className="source-details">
      <summary>
        <Info size={16} aria-hidden="true" />
        Data sources
        <CaretDown size={12} aria-hidden="true" />
      </summary>
      <div className="source-popover">
        {health && Object.keys(health).length ? (
          Object.entries(health).map(([name, status]) => (
            <div key={name}>
              <span className="capitalize">{name.replaceAll('_', ' ')}</span>
              <span
                className={
                  status === 'ok'
                    ? 'text-emerald-300'
                    : status === 'empty'
                      ? 'text-amber-300'
                      : 'text-red-300'
                }
              >
                {status === 'ok'
                  ? 'Connected'
                  : status === 'empty'
                    ? 'No data'
                    : 'Unavailable'}
              </span>
            </div>
          ))
        ) : (
          <p>Source status is not available yet.</p>
        )}
      </div>
    </details>
  );
}

function UpcomingRelease({
  event: candidate,
}: {
  event: UpcomingEvent | null | undefined;
}) {
  const now = useMarketClock();
  const event = candidate && Date.parse(candidate.date) > now ? candidate : null;
  return (
    <section className="context-panel" aria-labelledby="release-title">
      <div className="context-heading">
        <CalendarBlank size={20} aria-hidden="true" />
        <h2 id="release-title">On the calendar</h2>
        <span className="ml-auto text-xs text-zinc-400">Next release</span>
      </div>
      {event ? (
        <>
          <div className="release-content">
            <div className="release-date" aria-hidden="true">
              <span>
                {new Date(event.date).toLocaleDateString(undefined, {
                  month: 'short',
                })}
              </span>
              <strong>{new Date(event.date).getDate()}</strong>
            </div>
            <div className="release-info">
              <div className="release-meta">
                <span>{event.country}</span>
                <span className="impact-label">{event.impact} impact</span>
              </div>
              <h3>{event.name}</h3>
              <p>
                {new Date(event.date).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}
              </p>
            </div>
          </div>
          <p className="release-affects">
            <span>Affected markets</span>
            {event.affects.map((symbol) => (
              <span key={symbol} className="release-market">
                {symbol}
              </span>
            ))}
          </p>
        </>
      ) : (
        <div className="calendar-empty">
          <span className="calendar-icon">
            <CalendarBlank size={25} aria-hidden="true" />
          </span>
          <div>
            <h3>No upcoming release available</h3>
            <p>
              The economic calendar hasn’t returned an upcoming event. Check
              source status for availability.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [response, setResponse] = useState<BiasApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const returnPosition = useRef<number | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('mf-market-return');
      if (!saved) return;
      sessionStorage.removeItem('mf-market-return');
      const state = JSON.parse(saved);
      if (['all', 'bullish', 'bearish', 'neutral'].includes(state.filter)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore saved navigation state after hydration
        setFilter(state.filter);
      }
      if (Number.isFinite(state.scrollY)) returnPosition.current = Math.max(0, state.scrollY);
    } catch { /* Dashboard navigation also works without browser storage. */ }
  }, []);

  useEffect(() => {
    if (loading || returnPosition.current === null) return;
    const position = returnPosition.current;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: position, behavior: 'instant' });
      returnPosition.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  const fetchBias = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await fetch('/api/bias', { cache: 'no-store' });
      if (!result.ok)
        throw new Error('Market data could not be loaded. Please try again.');
      const json: BiasApiResponse = await result.json();
      if (mounted.current) {
        setResponse(json);
        setError(null);
      }
    } catch (err) {
      if (mounted.current)
        setError(
          err instanceof Error
            ? err.message
            : 'Market data is temporarily unavailable.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void fetchBias(), 0);
    const refreshVisible = () => { if (!document.hidden) void fetchBias(); };
    const interval = setInterval(refreshVisible, 300000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [fetchBias]);

  const data = response?.data.map(consistentBiasReading) ?? [];
  const visible = data
    .filter(
      (item) =>
        filter === 'all' ||
        (filter === 'neutral'
          ? item.direction === 'neutral'
          : item.direction.includes(filter)),
    )
    .sort((a, b) => Math.abs(b.biasPercent) - Math.abs(a.biasPercent) || a.symbol.localeCompare(b.symbol));
  // Conviction sets each tile's size; packBoard also orders the narrow-screen list.
  const tiles = packBoard(visible);
  const historyScale = Math.max(
    20,
    ...data.flatMap((item) =>
      item.history.slice(-7).map((entry) => Math.abs(entry.biasScore)),
    ),
  );
  const bullish = data.filter((d) => d.direction.includes('bullish')).length;
  const bearish = data.filter((d) => d.direction.includes('bearish')).length;
  const summary =
    data.length === 0
      ? 'Waiting for the latest macro picture.'
      : bullish === data.length
        ? 'Bullish across the board.'
        : bearish === data.length
          ? 'A broad bearish lean.'
          : bullish > bearish
            ? 'Markets are leaning bullish.'
            : bearish > bullish
              ? 'Markets are leaning bearish.'
              : 'A mixed macro picture.';
  const source = response?.source ?? 'baseline';
  const uniqueEvents = [
    ...new Map(data.flatMap((d) => d.events).map((e) => [e.id, e])).values(),
  ];
  // The full analysis page links back here; restore the filter and scroll on return.
  const rememberPosition = () => {
    try { sessionStorage.setItem('mf-market-return', JSON.stringify({ filter, scrollY: window.scrollY })); } catch { /* Optional return-state storage. */ }
  };
  const drivers = [...uniqueEvents]
    .sort((a, b) => Math.abs(b.scoreChange) - Math.abs(a.scoreChange))
    .slice(0, 3);

  return (
    <div className="dashboard-page">
      <WorkspaceHeader
        active="overview"
        status={
          <span
            className={`data-status ${source === 'baseline' ? 'is-baseline' : ''}`}
          >
            <span />
            {loading && !response ? 'Connecting' : SOURCE_LABELS[source]}
          </span>
        }
        meta={
          <>
            <p>
              {response
                ? `Updated ${new Date(response.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Connecting to market sources'}
            </p>
            <RefreshTime timestamp={response?.timestamp ?? null} />
          </>
        }
      />
      <main id="main-content" className="workspace-main">
        {marketFeatures.calendar && <PanelErrorBoundary name="Weekly economic releases"><WeeklyEconomicCalendar /></PanelErrorBoundary>}
        <div className="overview-summary">
          <div className="summary-reading">
            <span className="summary-label">The current read</span>
            <h2>{summary}</h2>
            <div className="summary-facts">
              <span>
                <strong>
                  {data.length
                    ? `${data.filter((d) => d.conviction === 'high').length}/${data.length}`
                    : '—'}
                </strong>{' '}
                {data.some(row => row.forecast) ? "high confidence" : "high conviction"}
              </span>
              <span>
                <strong>{response ? uniqueEvents.length : '—'}</strong> distinct
                drivers
              </span>
            </div>
          </div>
          <MarketBreadth data={data} />
        </div>

        {!marketFeatures.macro && response?.dxy && (
          <div className="dxy-strip">
            <span className="dxy-symbol">DXY</span>
            <strong>{response.dxy.price}</strong>
            <span
              className={
                response.dxy.percentChange >= 0
                  ? 'text-emerald-300'
                  : 'text-red-300'
              }
            >
              {response.dxy.percentChange >= 0 ? '+' : ''}
              {response.dxy.percentChange.toFixed(2)}%
            </span>
            <span className="capitalize text-zinc-300">
              {response.dxy.status}
            </span>
            <span className="dxy-summary">{response.dxy.summary}</span>
          </div>
        )}
        {(response?.stale || error) && (
          <div role="alert" className="notice">
            <WarningCircle size={19} aria-hidden="true" />
            <p>
              {error ??
                'Some sources are unavailable. Showing the last known data; it may be outdated.'}
            </p>
            <button onClick={() => void fetchBias()} disabled={loading}>
              Retry
            </button>
          </div>
        )}
        {response?.source === 'baseline' && (
          <p className="baseline-note">
            <Info size={16} aria-hidden="true" />
            Showing baseline values. Live sources haven’t returned data yet.
          </p>
        )}

        <section className="markets-section" aria-labelledby="markets-title">
          <div className="section-heading">
            <div>
              <h2 id="markets-title">
                Market overview
                <span className="section-count">{data.length || '—'}</span>
              </h2>
              <p>Four-hour predictions from price action, recent news and macro context.</p>
            </div>
            <button
              onClick={() => void fetchBias()}
              disabled={loading}
              className="refresh-button"
            >
              <ArrowClockwise
                size={16}
                className={loading ? 'refreshing' : ''}
                aria-hidden="true"
              />
              {loading ? 'Updating' : 'Refresh'}
            </button>
          </div>
          <div className="market-toolbar">
            <div
              className="market-filters"
              role="group"
              aria-label="Filter markets by direction"
            >
              {(['all', 'bullish', 'bearish', 'neutral'] as Filter[]).map(
                (value) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={
                      value === 'all'
                        ? 'All markets'
                        : value.charAt(0).toUpperCase() + value.slice(1)
                    }
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {value === 'all'
                      ? 'All markets'
                      : value.charAt(0).toUpperCase() + value.slice(1)}
                    {data.length > 0 && (
                      <span aria-hidden="true">
                        {value === 'all'
                          ? data.length
                          : data.filter((item) =>
                              item.direction.includes(value),
                            ).length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
            <SourceStatus health={response?.sourceHealth ?? null} />
          </div>
          <p className="sr-only" role="status">
            {loading
              ? 'Updating markets'
              : `Showing ${visible.length} ${filter === 'all' ? '' : filter + ' '}markets`}
          </p>
          <div className="market-grid" aria-busy={loading}>
            {loading &&
              !response &&
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="market-skeleton" aria-hidden="true">
                  <div />
                  <div />
                  <div />
                  <div />
                </div>
              ))}
            <AnimatePresence initial={false}>
              {tiles.map((tile, index) => (
                <MarketCard
                  key={tile.item.symbol}
                  data={tile.item}
                  tile={tile}
                  onNavigate={rememberPosition}
                  index={index}
                  historyScale={historyScale}
                  chanceBlocked={!!error || !!response?.stale || response?.source === 'baseline'}
                />
              ))}
            </AnimatePresence>
          </div>
          {!loading && visible.length === 0 && (
            <div className="market-empty">
              <SquaresEmpty />
              <h3>
                {response
                  ? `No ${filter === 'all' ? '' : filter + ' '}markets to show`
                  : 'Market data is unavailable'}
              </h3>
              <p>
                {response
                  ? 'Choose another direction to see the rest of your watchlist.'
                  : 'Check your connection and try refreshing.'}
              </p>
              {filter !== 'all' && (
                <button className="text-link" onClick={() => setFilter('all')}>
                  Show all markets <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <p className="market-footnote">
            <span className="legend-dot" />
            Percentages estimate the chance of moving up or down over the next four hours, using price action, news and macro context. They are uncalibrated model estimates. Open a market for both directions and the forecast inputs.
          </p>
        </section>

        <div className="context-grid">
          <div>
            <UpcomingRelease event={response?.nextEvent} />
            {response?.calendarStatus === 'stale' && <p className="market-panel-note">Next release uses a last-known schedule. Check the calendar source status below.</p>}
          </div>
          <section className="context-panel" aria-labelledby="drivers-title">
            <div className="context-heading">
              <span className="mini-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <h2 id="drivers-title">Behind the bias</h2>
              <span className="ml-auto text-xs text-zinc-400">Key drivers</span>
            </div>
            {drivers.length ? (
              <ol className="driver-list">
                {drivers.map((driver, i) => (
                  <li key={driver.id}>
                    <span className="driver-index">0{i + 1}</span>
                    <div>
                      <p>{driver.title}</p>
                      <span>
                        {driver.sourceName ??
                          driver.category.replaceAll('_', ' ')}{' '}
                        · {driver.impact} impact
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-zinc-400 mt-6">
                Market drivers will appear when data sources return events.
              </p>
            )}
          </section>
        </div>

        {(marketFeatures.calendar || marketFeatures.macro) && <div className="market-context-grid">
          {marketFeatures.calendar && <PanelErrorBoundary name="Economic calendar"><EconomicCalendar /></PanelErrorBoundary>}
          {marketFeatures.macro && <PanelErrorBoundary name="Macro context"><MacroContext /></PanelErrorBoundary>}
        </div>}

        <section className="journal-invitation">
          <div className="journal-invitation-icon">
            <BookOpen size={24} aria-hidden="true" />
          </div>
          <div>
            <h2>The context is here. Make the trade your own.</h2>
            <p>
              Log your decisions, connect MT5, and build a clearer picture of
              your performance.
            </p>
          </div>
          <Link href="/journal" className="primary-button">
            Open your journal
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </section>
        <div className="workspace-bottom">
          <span>
            <CheckCircle size={14} aria-hidden="true" />
            Built for a more deliberate trading day.
          </span>
          <span>MacroFlow / Market intelligence</span>
        </div>
      </main>
      <footer className="workspace-footer">
        <div className="workspace-footer-inner">
          <Disclaimer />
        </div>
      </footer>
    </div>
  );
}

function SquaresEmpty() {
  return (
    <CalendarBlank
      size={28}
      className="text-zinc-400 mx-auto mb-4"
      aria-hidden="true"
    />
  );
}
