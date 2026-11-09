import type { BiasResult, HistoryEntry, ScoredEvent } from '@/lib/types';
import { directionLabel, signed } from '@/lib/market/symbols';

function DriverGroup({ title, events, empty }: { title: string; events: ScoredEvent[]; empty: string }) {
  return (
    <div className="research-driver-group">
      <h3>{title} <span>({events.length})</span></h3>
      {events.length ? <ul className="research-drivers">{[...events].sort((a, b) => Math.abs(b.scoreChange) - Math.abs(a.scoreChange)).map((event) => (
        <li key={event.id}>
          <details>
            <summary>
              <span className="research-driver-title">{event.title}<span>{event.impact} impact</span></span>
              <span className={`research-contribution ${event.scoreChange > 0 ? 'research-positive' : event.scoreChange < 0 ? 'research-negative' : ''}`}>{signed(event.scoreChange)}<span>score input</span></span>
            </summary>
            <div className="research-driver-body">
              <p>{event.description}</p>
              <p className="research-note">{event.sourceName || 'Source not supplied'}</p>
              {event.url && <a href={event.url} target="_blank" rel="noopener noreferrer">Read source article</a>}
            </div>
          </details>
        </li>
      ))}</ul> : <p className="research-note">{empty}</p>}
    </div>
  );
}

export function MarketDrivers({ data }: { data: BiasResult }) {
  const bullish = data.events.filter((event) => event.scoreChange > 0);
  const bearish = data.events.filter((event) => event.scoreChange < 0);
  const unscored = data.events.filter((event) => event.scoreChange === 0);
  const neutral = data.direction === 'neutral';
  const negative = data.direction.includes('bearish');
  return (
    <section id="market-drivers" className="research-section" aria-labelledby="market-drivers-title">
      <h2 id="market-drivers-title">Why this bias</h2>
      <p className="research-note">Open a driver to read the evidence. Inputs reflect scoring rules; the final score is capped between -100 and +100.</p>
      {neutral ? <>
        <DriverGroup title="Bullish drivers" events={bullish} empty="No bullish drivers in this read." />
        <DriverGroup title="Bearish drivers" events={bearish} empty="No bearish drivers in this read." />
      </> : <>
        <DriverGroup title="Supporting drivers" events={negative ? bearish : bullish} empty="No drivers support the current direction." />
        <DriverGroup title="Opposing drivers" events={negative ? bullish : bearish} empty="No opposing drivers in this read." />
      </>}
      {unscored.length > 0 && <DriverGroup title="Unscored context" events={unscored} empty="" />}
    </section>
  );
}

// Use calendar dates, not equally spaced array indices: missing days leave gaps.
function recentHistory(history: HistoryEntry[]) {
  const entries = [...new Map(history.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(Date.parse(entry.date)) && Number.isFinite(entry.biasScore)).map((entry) => [entry.date, entry])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const end = entries.length ? Date.parse(entries.at(-1)!.date) : 0;
  return { entries: entries.filter((entry) => end - Date.parse(entry.date) <= 6 * 86_400_000), end };
}

export function MarketBiasHistory({ data }: { data: BiasResult }) {
  const { entries, end } = recentHistory(data.history);
  const x = (date: string) => 48 + ((Date.parse(date) - (end - 6 * 86_400_000)) / (6 * 86_400_000)) * 464;
  const y = (score: number) => 106 - Math.max(-100, Math.min(100, score)) * .8;
  return (
    <section id="market-history" className="research-section" aria-labelledby="market-history-title">
      <h2 id="market-history-title">Bias history</h2>
      <p className="research-note">Seven daily snapshots on a fixed score scale. This tracks fundamental bias, not market price.</p>
      {entries.length ? <>
        <svg className="research-history-chart" viewBox="0 0 540 220" role="img" aria-label={`${data.symbol} bias history, score range minus 100 to plus 100. Values are listed in the table below.`}>
          {[-100, 0, 100].map((score) => <g key={score}><text x="0" y={y(score) + 4}>{signed(score)}</text><path className={score === 0 ? 'research-zero' : 'research-gridline'} d={`M48 ${y(score)}H512`} /></g>)}
          {entries.map((entry, i) => <g key={entry.date}>
            {i > 0 && Date.parse(entry.date) - Date.parse(entries[i - 1].date) === 86_400_000 && <path className="research-history-line" d={`M${x(entries[i - 1].date)} ${y(entries[i - 1].biasScore)}L${x(entry.date)} ${y(entry.biasScore)}`} />}
            <circle className="research-history-point" cx={x(entry.date)} cy={y(entry.biasScore)} r="3" />
          </g>)}
          <text x="48" y="212">{new Date(end - 6 * 86_400_000).toISOString().slice(5, 10)}</text><text x="512" y="212" textAnchor="end">{entries.at(-1)!.date.slice(5)}</text>
        </svg>
        {entries.length === 1 && <p className="research-note">One daily snapshot available. More points will appear as history builds.</p>}
        <div className="research-history-table" tabIndex={0} role="region" aria-label="Scrollable daily bias history"><table>
          <caption>Daily bias history for {data.symbol}</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Direction</th><th scope="col">Score</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.date}><th scope="row"><time dateTime={entry.date}>{entry.date}</time></th><td>{directionLabel(entry.direction)}</td><td>{signed(entry.biasScore)}</td></tr>)}</tbody>
        </table></div>
      </> : <p className="research-empty">No daily snapshots yet. History builds as this market is observed.</p>}
    </section>
  );
}

export function MarketMethodology({ data }: { data: BiasResult }) {
  const bullish = data.events.filter((event) => event.scoreChange > 0).length;
  const bearish = data.events.filter((event) => event.scoreChange < 0).length;
  return (
    <section className="research-section research-methodology" aria-labelledby="score-method-title">
      <h2 id="score-method-title">How to read the score</h2>
      <details>
        <summary>Score breakdown and methodology</summary>
        <dl className="research-breakdown">
          <div><dt>Raw score</dt><dd>{signed(data.biasScore)} / [-100, +100]</dd></div>
          <div><dt>Signal</dt><dd>{data.signal.replaceAll('_', ' ')}</dd></div>
          <div><dt>Strength</dt><dd>{data.strength}</dd></div>
          <div><dt>Agreement</dt><dd>{data.confirmationRatio}%</dd></div>
          <div><dt>Signal coverage</dt><dd>{data.confidenceCount} / {data.totalPossibleSignals} possible rules</dd></div>
          <div><dt>Scored events</dt><dd>{data.eventCount}</dd></div>
          <div><dt>Bullish / bearish</dt><dd>{bullish} / {bearish}</dd></div>
          <div><dt>High-impact events</dt><dd>{data.events.filter((event) => event.impact === 'high').length}</dd></div>
        </dl>
        <p>The displayed percentage is the rounded signed score on a -100 to +100 scale. It is not a win probability or a price return. Scores above +50 are bullish; +15 to +50 lean bullish. Scores from -14 to +14 are neutral; -50 to -15 lean bearish, and below -50 is bearish.</p>
        <p>Conviction combines score magnitude, event count, high-impact events and directional agreement. High conviction needs a magnitude above 40, at least three scored events, a high-impact event and at least 60% agreement. Medium conviction needs a magnitude above 25, at least two events and a high-impact event.</p>
        <p>Agreement measures the share on the more common bullish or bearish side, which may differ from the weighted score direction. Coverage counts matched scored events against configured rules; it is not a confidence probability. Inputs already reflect category caps and rule adjustments; final score clamping can prevent them from summing to the displayed score. Technical price confirmation is not measured here.</p>
      </details>
    </section>
  );
}
