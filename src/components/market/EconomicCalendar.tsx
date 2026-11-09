'use client';

import { useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import type { CalendarData, Resource } from '@/lib/market/types';
import { useMarketResource } from './useMarketResource';
import SourceMeta, { resourceExpired } from './SourceMeta';
import { useMarketClock } from './useMarketClock';

export default function EconomicCalendar() {
  const { data, loading, error, refresh } = useMarketResource<Resource<CalendarData>>('/api/calendar');
  const [period, setPeriod] = useState('week');
  const [currency, setCurrency] = useState('all');
  const [impact, setImpact] = useState('all');
  const now = useMarketClock();
  const calendar = data && !resourceExpired(data.meta, now) ? data.data : null;
  const today = new Date(now).toLocaleDateString();
  const events = calendar?.events.filter((event) =>
    (period === 'week' || new Date(event.date).toLocaleDateString() === today)
    && (currency === 'all' || event.currency === currency)
    && (impact === 'all' || event.impact === impact)) ?? [];
  const next = calendar?.events.find((event) => Date.parse(event.date) > now && ['high', 'medium'].includes(event.impact));

  return (
    <section id="economic-calendar" className="context-panel economic-calendar" aria-labelledby="calendar-title" tabIndex={-1}>
      <div className="context-heading">
        <CalendarBlank size={20} aria-hidden="true" />
        <h2 id="calendar-title">Economic calendar</h2>
        <button className="market-panel-retry" disabled={loading} onClick={() => void refresh()}>{loading ? 'Updating calendar' : 'Refresh calendar'}</button>
      </div>
      <p className="market-panel-note">{!calendar ? (loading ? 'Checking upcoming releases…' : 'Upcoming releases are unavailable.') : next ? `Next release: ${next.title}` : 'No upcoming high or medium impact release in the available schedule.'}</p>
      <div className="calendar-filters">
        <div><label htmlFor="calendar-view">View</label><select id="calendar-view" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="week">Four-week schedule</option><option value="today">Today</option></select></div>
        <div><label htmlFor="calendar-currency">Currency</label><select id="calendar-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="all">USD + GBP</option><option>USD</option><option>GBP</option></select></div>
        <div><label htmlFor="calendar-impact">Impact</label><select id="calendar-impact" value={impact} onChange={(e) => setImpact(e.target.value)}><option value="all">All impacts</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="holiday">Holiday</option></select></div>
      </div>
      {error && <p className="market-panel-note" role="alert">Calendar refresh failed. Displayed data may be outdated.</p>}
      {data?.meta.status === 'stale' && <p className="market-panel-note" role="status">{calendar?.sources?.some((s) => s.status === 'unavailable') ? 'Some agencies are unavailable. Available schedules are shown below.' : 'Showing the last-known schedule while the source is unavailable.'}</p>}
      {loading && !data ? <p className="market-panel-note" role="status">Loading economic releases…</p> : !calendar ? <p className="market-panel-note">The economic calendar is unavailable. Try refreshing.</p> : (
        <>
          {calendar.windowStart && calendar.windowEnd && <p className="market-panel-note">Feed dates: {new Date(calendar.windowStart).toLocaleDateString()} – {new Date(calendar.windowEnd).toLocaleDateString()}. Times use your local timezone.</p>}
          <div className="calendar-table-wrap" tabIndex={0} role="region" aria-label="Scrollable economic releases">
            <table className="economic-table">
              <caption className="sr-only">Economic releases for USD and GBP</caption>
              <thead><tr><th scope="col">Release / local time</th><th scope="col">Priority</th><th scope="col">Source</th></tr></thead>
              <tbody>{events.map((event) => (
                <tr key={event.id}>
                  <th scope="row"><strong>{event.currency} · {event.title}</strong><time dateTime={event.date}>{new Date(event.date).toLocaleString(undefined, event.impact === 'holiday' ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}{event.impact === 'holiday' && ' · Holiday'}</time><span className="calendar-affects">Markets: {event.affects.join(', ')}</span></th>
                  <td><span className={`calendar-impact impact-${event.impact}`}>{event.impact}</span></td>
                  <td>{event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">{event.sourceName}</a> : 'Official schedule'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!events.length && <p className="market-panel-note">No releases match these filters in the available schedule.</p>}
        </>
      )}
      <p className="market-panel-note">Selected BLS, BEA and ONS releases only; this is not a complete economic calendar. Impact filters use MacroFlow editorial priorities. Forecasts, previous values and released actuals are not supplied. Scheduled events do not change bias scores.</p>
      {calendar?.sources && <ul className="market-panel-note">{calendar.sources.map((source) => <li key={source.name}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a>: {source.status}{source.fetchedAt && ` · checked ${new Date(source.fetchedAt).toLocaleString()}`}</li>)}</ul>}
      <p className="market-panel-note">Sources: U.S. Bureau of Labor Statistics; U.S. Bureau of Economic Analysis; Office for National Statistics. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">Open Government Licence v3.0</a>.</p>
      {data && <SourceMeta meta={data.meta} now={now} />}
    </section>
  );
}
