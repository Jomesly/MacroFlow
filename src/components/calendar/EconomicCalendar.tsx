'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CalendarEvent, CalendarImpact } from '@/lib/types';
import {
  ALL_IMPACTS, DEFAULT_FILTERS, filterEvents, groupByLocalDay, loadFilters, todayCounts,
} from '@/lib/calendar/view';
import { readStoredFilters, subscribeFilters, updateFilters } from '@/lib/calendar/filter-store';
import ImpactFolder, { IMPACT_STYLE } from './ImpactFolder';

const REFRESH_MS = 15 * 60_000;
const IMPACT_LABEL: Record<CalendarImpact, string> = { high: 'High', medium: 'Medium', low: 'Low', holiday: 'Holiday' };
const PREFERRED_CURRENCIES = ['USD', 'GBP', 'EUR', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];

type Status = 'loading' | 'ready' | 'stale' | 'unavailable';

// Browser-only values via useSyncExternalStore: the server renders defaults, the client its stored values.
const noSubscribe = () => () => {};
const readTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function countdown(target: string, now: number): string {
  const diff = Date.parse(target) - now;
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 cursor-pointer ${
        pressed ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}

function Value({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <span className="tabular-nums">
      <span className="md:hidden text-zinc-600 mr-1">{label}</span>
      <span className={value ? (strong ? 'text-zinc-100 font-semibold' : 'text-zinc-400') : 'text-zinc-700'}>{value ?? '-'}</span>
    </span>
  );
}

export default function EconomicCalendar() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<'ok' | 'failed'>('ok');
  const [refreshing, setRefreshing] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const storedFilters = useSyncExternalStore(subscribeFilters, readStoredFilters, () => null);
  const filters = useMemo(() => (storedFilters ? loadFilters({ getItem: () => storedFilters }) : DEFAULT_FILTERS), [storedFilters]);
  const timeZone = useSyncExternalStore(noSubscribe, readTimeZone, () => 'UTC');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setRefreshing(true);
    setStatus(prev => prev === 'unavailable' ? 'loading' : prev);
    try {
      const res = await fetch('/api/calendar', { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.events)) throw new Error('Invalid calendar response');
      if (!mounted.current || activeRequest.current !== controller) return;
      setEvents(json.events);
      setLastSuccess(new Date().toISOString());
      setArchiveStatus(json.archiveStatus === 'ok' ? 'ok' : 'failed');
      setStatus('ready');
    } catch {
      if (mounted.current && activeRequest.current === controller) setStatus(prev => (prev === 'ready' || prev === 'stale' ? 'stale' : 'unavailable'));
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const first = setTimeout(load, 0);
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted.current = false;
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.abort();
      clearTimeout(first); clearInterval(refresh); clearInterval(tick);
    };
  }, [load]);

  const update = updateFilters;
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);

  const currencies = useMemo(() => {
    const present = new Set(events.map(e => e.currency));
    filters.currencies.forEach(c => present.add(c));
    return [...present].sort((a, b) => {
      const ia = PREFERRED_CURRENCIES.indexOf(a), ib = PREFERRED_CURRENCIES.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  }, [events, filters.currencies]);

  const nowDate = new Date(now);
  const visible = filterEvents(events, filters, nowDate, timeZone);
  const groups = groupByLocalDay(visible, timeZone);
  const counts = todayCounts(events, filters.currencies, nowDate, timeZone);
  const nextHigh = events.find(e => e.impact === 'high' && filters.currencies.includes(e.currency) && Date.parse(e.time) > now);
  const nextVisibleId = visible.find(e => Date.parse(e.time) > now)?.id;
  const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const hasData = status === 'ready' || status === 'stale';
  const lastRefreshLabel = lastSuccess && new Intl.DateTimeFormat('en-GB', { timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(lastSuccess));

  return (
    <section aria-labelledby="calendar-heading" className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 id="calendar-heading" className="text-xs font-medium text-zinc-400">Economic calendar</h2>
          {hasData && (
            <p role="status" aria-atomic="true" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1.5"><ImpactFolder impact="high" /> <b className="text-zinc-100">{counts.high}</b> high</span>
              <span className="inline-flex items-center gap-1.5"><ImpactFolder impact="medium" /> <b className="text-zinc-100">{counts.medium}</b> medium today</span>
              {nextHigh && (
                <span className="text-zinc-400">
                  Next high: <span className="text-zinc-100">{nextHigh.currency} {nextHigh.title}</span> at {fmtTime(nextHigh.time)}
                  <span className="text-blue-300 font-mono" aria-hidden="true"> (in {countdown(nextHigh.time, now)})</span>
                </span>
              )}
            </p>
          )}
        </div>
        <div role="group" aria-label="Date range" className="inline-flex self-start rounded-lg border border-zinc-800 p-0.5 md:self-auto">
          {(['today', 'week'] as const).map(range => (
            <button
              key={range}
              type="button"
              aria-pressed={filters.range === range}
              onClick={() => update({ ...filters, range })}
              className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                filters.range === range ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {range === 'today' ? 'Today' : 'This week'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3" role="group" aria-label="Filters">
        {ALL_IMPACTS.map(impact => (
          <Chip key={impact} pressed={filters.impacts.includes(impact)} onClick={() => update({ ...filters, impacts: toggle(filters.impacts, impact) })}>
            <ImpactFolder impact={impact} className="w-3.5 h-3" /> {IMPACT_LABEL[impact]}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden="true" />
        {currencies.map(currency => (
          <Chip key={currency} pressed={filters.currencies.includes(currency)} onClick={() => update({ ...filters, currencies: toggle(filters.currencies, currency) })}>
            {currency}
          </Chip>
        ))}
      </div>

      <div className="px-4 pb-3 pt-2">
        {status === 'loading' && (
          <div className="space-y-2 py-2" aria-label="Loading calendar">
            {[0, 1, 2].map(i => <div key={i} className="h-7 rounded-md bg-zinc-800/50 animate-pulse motion-reduce:animate-none" />)}
          </div>
        )}

        {status === 'unavailable' && (
          <div className="flex items-center justify-between gap-3 py-3">
            <p role="alert" className="text-xs text-zinc-500">Calendar unavailable right now. Economic release coverage may be incomplete.</p>
            <button type="button" disabled={refreshing} onClick={load} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer disabled:opacity-50">Retry</button>
          </div>
        )}

        {hasData && (status === 'stale' || archiveStatus === 'failed') && (
          <div role="alert" className="my-2 flex items-center justify-between gap-3 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2">
            <div className="text-xs text-amber-200">
              {status === 'stale' && <p>Calendar refresh failed. Showing saved events. Last successful refresh: {lastRefreshLabel} ({timeZone}).</p>}
              {archiveStatus === 'failed' && <p>Forecast archive unavailable. Economic release surprises are excluded from bias scoring.</p>}
            </div>
            <button type="button" disabled={refreshing} onClick={load} className="shrink-0 text-xs text-blue-300 hover:text-blue-200 cursor-pointer disabled:opacity-50">{refreshing ? 'Retrying…' : 'Retry'}</button>
          </div>
        )}

        {hasData && visible.length === 0 && (
          <div className="flex items-center justify-between gap-3 py-3">
            <p className="text-xs text-zinc-500">
              {filters.range === 'today' ? 'No events match these filters today.' : 'No events match these filters this week.'}
            </p>
            {filters.range === 'today' && (
              <button type="button" onClick={() => update({ ...filters, range: 'week' })} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">Show this week</button>
            )}
          </div>
        )}

        {hasData && visible.length > 0 && (
          <div role="table" aria-label="Economic events" className={`text-xs ${filters.range === 'week' ? 'max-h-[30rem] overflow-y-auto overflow-x-hidden overscroll-contain pr-1' : ''}`}>
            <div role="row" className="hidden md:grid grid-cols-[3.5rem_1.25rem_2.75rem_1fr_4.5rem_4.5rem_4.5rem] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-zinc-600">
              <span role="columnheader">Time</span>
              <span role="columnheader"><span className="sr-only">Impact</span></span>
              <span role="columnheader">Cur</span>
              <span role="columnheader">Event</span>
              <span role="columnheader" className="text-right">Actual</span>
              <span role="columnheader" className="text-right">Forecast</span>
              <span role="columnheader" className="text-right">Previous</span>
            </div>
            {groups.map(group => (
              <div key={group.day} role="rowgroup">
                {filters.range === 'week' && (
                  <div role="row" className="mt-2 rounded-md bg-zinc-900 px-2 py-1 text-[11px] text-zinc-500">
                    <span role="cell">{group.label}</span>
                  </div>
                )}
                {group.events.map(event => {
                  const past = Date.parse(event.time) <= now;
                  const isNext = event.id === nextVisibleId;
                  return (
                    <div
                      key={event.id}
                      role="row"
                      aria-current={isNext ? 'true' : undefined}
                      className={`grid grid-cols-[3.5rem_1.25rem_2.75rem_1fr] md:grid-cols-[3.5rem_1.25rem_2.75rem_1fr_4.5rem_4.5rem_4.5rem] items-center gap-x-2 gap-y-1 border-b border-zinc-800/60 px-2 py-2 last:border-b-0 ${
                        isNext ? 'bg-blue-950/20 shadow-[inset_2px_0_0_var(--color-blue-500)]' : ''
                      } ${past ? 'text-zinc-500' : 'text-zinc-300'}`}
                    >
                      <span role="cell" className="tabular-nums text-zinc-400">{event.impact === 'holiday' ? 'All day' : fmtTime(event.time)}</span>
                      <span role="cell"><ImpactFolder impact={event.impact} /></span>
                      <span role="cell" className="font-semibold text-zinc-200">{event.currency}</span>
                      <span role="cell" className="min-w-0 md:truncate" title={`${event.title} (${IMPACT_STYLE[event.impact].label})`}>{event.title}</span>
                      <span className="col-span-4 flex gap-4 pl-[8.5rem] text-[11px] md:contents">
                        <span role="cell" className="md:text-right md:text-xs"><Value label="A" value={event.actual} strong /></span>
                        <span role="cell" className="md:text-right md:text-xs"><Value label="F" value={event.forecast} /></span>
                        <span role="cell" className="md:text-right md:text-xs"><Value label="P" value={event.previous} /></span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <p className="mt-2 text-[10px] text-zinc-600">
          Calendar data: ForexFactory. Actuals for major US releases from FRED; other actuals are not available yet.
        </p>
      </div>
    </section>
  );
}
