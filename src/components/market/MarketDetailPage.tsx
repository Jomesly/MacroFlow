'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, Minus, X } from '@phosphor-icons/react';
import { gradeBadge } from '@/lib/signal-grade';
import { PROVEN_MIN_DAYS, PROVEN_MIN_LOWER_BOUND, PROVEN_MIN_SIGNALS, type TrackRecordResponse } from '@/lib/signals/track-record';
import type { AssetSymbol, BiasApiResponse } from '@/lib/types';
import { consistentBiasReading } from '@/lib/bias-reading';
import { referenceCharts } from '@/lib/market/instruments';
import { directionLabel, marketSymbols, signed } from '@/lib/market/symbols';
import { marketIsOpen } from '@/lib/marketIsOpen';
import { marketFeatures } from '@/lib/market/features';
import { useMarketResource } from './useMarketResource';
import { useMarketClock } from './useMarketClock';
import { biasWord, convictionLabel, factorCounts, marketFactors } from '@/lib/market-factors';
import FactorList from './FactorList';
import { MarketBiasAxis, MarketBiasHistory, MarketDrivers, MarketMethodology } from './MarketAnalysis';
import EconomicCalendar from './EconomicCalendar';
import MacroContext from './MacroContext';
import PanelErrorBoundary from './PanelErrorBoundary';

export default function MarketDetailPage({ symbol }: { symbol: AssetSymbol }) {
  const [technicalSide, setTechnicalSide] = useState('none');
  const { data: response, loading, error, refresh } = useMarketResource<BiasApiResponse>(`/api/bias?symbol=${symbol}`, 300_000, 'no-store');
  const now = useMarketClock();
  const { data: trackRecord } = useMarketResource<TrackRecordResponse>('/api/signals/track-record', 900_000);
  const data = response?.data.map(consistentBiasReading).find((entry) => entry.symbol === symbol);
  const reference = referenceCharts[symbol];
  const degraded = response?.sourceHealth && Object.values(response.sourceHealth).some((status) => status === 'failed');
  const tone = data?.direction.includes('bullish') ? 'positive' : data?.direction.includes('bearish') ? 'negative' : 'neutral';
  const counts = data ? factorCounts(data) : { bullish: 0, bearish: 0 };
  const DirectionIcon = tone === 'positive' ? ArrowUpRight : tone === 'negative' ? ArrowDownRight : Minus;
  return (
    <div className={`market-research research-tone-${tone}`} data-conviction={data?.conviction}>
      <header className="research-navigation">
        <Link href="/" className="research-back">Back to markets</Link>
        <span>MacroFlow</span>
      </header>
      <nav className="research-markets" aria-label="Choose a market">
        {marketSymbols.map((market) => <Link key={market} href={`/markets/${market}`} aria-current={market === symbol ? 'page' : undefined} title={referenceCharts[market].name}>{market}</Link>)}
      </nav>
      <main id="main-content">
        {error && <p role="alert" className="research-notice">Analysis could not be refreshed. {data ? 'The last successful read is shown below and may be outdated.' : 'Try refreshing the analysis.'}</p>}
        <div className="research-hero">
          <header className="research-heading">
            <div><h1>{symbol}</h1><p>{reference.name}</p></div>
            <button type="button" className="research-action" onClick={() => void refresh()} disabled={loading}>{loading ? 'Updating analysis' : 'Refresh analysis'}</button>
          </header>
          {data && <section className="research-read" aria-label="Current market bias">
            <div className="research-bias">
              <p>{data.forecast ? 'News and macro bias / next 4h' : 'Macro bias strength'}</p>
              {data.forecast
                ? <strong>{biasWord(data.direction)}</strong>
                : <strong aria-label={`${signed(data.biasPercent)}% macro bias strength`}>{signed(data.biasPercent)}<span>%</span></strong>}
              <p className="research-direction"><DirectionIcon size={24} weight="bold" aria-hidden="true" />{data.forecast ? convictionLabel(data) : directionLabel(data.direction)}</p>
            </div>
            <div className="research-assessment">
              <p>{data.forecast ? data.forecast.summary : data.direction === 'neutral' ? 'No dominant fundamental direction in this read.' : `The scored evidence is ${directionLabel(data.direction)} with ${data.conviction} conviction.`}</p>
              <p className="research-note">{data.forecast ? 'These are the news and macro factors that may move this chart. Price action is not scored: use the bias to filter your technical setups, and trade it when your chart agrees.' : 'The percentage measures directional macro strength, not a win probability. High conviction requires at least 50% magnitude plus supporting evidence and market confirmation.'}</p>
              <dl>
                <div><dt>Strength</dt><dd>{data.direction === 'neutral' ? '—' : `${Math.abs(Math.round(data.biasPercent))}%`}</dd></div>
                <div><dt>Conviction</dt><dd>{data.conviction}</dd></div>
                {data.grade && <div><dt>Signal</dt><dd>{gradeBadge(data.grade)}</dd></div>}
                <div><dt>Drivers</dt><dd>{counts.bullish} bullish / {counts.bearish} bearish</dd></div>
                <div><dt>News sources</dt><dd>{data.forecast?.sourceCount ?? '—'}</dd></div>
                <div><dt>Session</dt><dd>{marketIsOpen(symbol, new Date(now)) ? 'Market open' : 'Market closed'}</dd></div>
              </dl>
            </div>
            {data.forecast ? <FactorList factors={marketFactors(data, 8)} detailed now={now} /> : <MarketBiasAxis data={data} />}
          </section>}
        </div>
        {loading && !response && <div className="research-loading" role="status"><span>Loading {symbol} analysis</span><div /><div /><div /></div>}
        {!loading && !data && <p className="research-empty">Analysis for {symbol} is unavailable. Use Refresh analysis to try again, or choose another market.</p>}
        {data && <>
          <div className="research-freshness" aria-live="polite">
            <p>Calculated <time dateTime={data.lastUpdated}>{new Date(data.lastUpdated).toLocaleString()}</time></p>
            <p>Source mode: {response!.source}. {error || response!.stale ? 'Outdated read.' : 'Latest available read.'}{degraded && ' Some providers are unavailable.'}{response!.source === 'baseline' && ' Baseline inputs; live confirmation is unavailable.'}</p>
            <p>Inputs fetched <time dateTime={response!.timestamp}>{new Date(response!.timestamp).toLocaleString()}</time></p>
          </div>
          {data.forecast && <section className="research-fact" aria-labelledby="forecast-title">
            <h2 id="forecast-title">Four-hour bias window</h2>
            <p>Issued <time dateTime={data.forecast.issuedAt}>{new Date(data.forecast.issuedAt).toLocaleString()}</time>. Valid until <time dateTime={data.forecast.expiresAt}>{new Date(data.forecast.expiresAt).toLocaleString()}</time>.</p>
            <p>{data.forecast.basis} inputs / {data.forecast.sourceCount} news sources / separate macro score {signed(data.forecast.macroBiasScore)}</p>
            {data.forecast.marketMove && <p>Price context (not scored), session move: {signed(Number(data.forecast.marketMove.sessionChangePercent.toFixed(2)))}%. Latest hour: {data.forecast.marketMove.recentChangePercent === null ? 'unavailable' : `${signed(Number(data.forecast.marketMove.recentChangePercent.toFixed(2)))}%`}.{data.forecast.marketMove.proxy && ' Gold futures proxy.'}</p>}
            {data.forecast.components && <dl className="research-breakdown">
              {Object.entries(data.forecast.components).map(([name, component]) => <div key={name}><dt>{name === 'news' ? 'News' : 'Macro data'}</dt><dd>{component ? `${signed(component.score)} / 100, ${Math.round(component.weight * 100)}% weight` : 'Unavailable'}</dd></div>)}
              <div><dt>Bias call</dt><dd>{data.signal.replaceAll('_', ' ')}</dd></div>
            </dl>}
            <ul>{data.forecast.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul>
          </section>}
          {data.grade && <section className="research-fact" aria-labelledby="signal-checks-title">
            <h2 id="signal-checks-title">Signal checks</h2>
            <p><strong>{gradeBadge(data.grade)}</strong></p>
            <p className="research-note">A signal needs fresh news and the macro backdrop pointing the same way. All seven checks make an A signal; missing only one of &ldquo;two sources&rdquo; or &ldquo;dollar and yield moves&rdquo; makes a B signal. Anything else is a lean, with no buy or sell call.</p>
            <ul className="signal-checks">{data.grade.checks.map(check => (
              <li key={check.id} className={check.passed ? 'is-passed' : 'is-failed'}>
                {check.passed ? <Check size={14} weight="bold" aria-hidden="true" /> : <X size={14} weight="bold" aria-hidden="true" />}
                <span><span className="sr-only">{check.passed ? 'Passed: ' : 'Not met: '}</span>{check.label}
                  {check.detail && <small className="signal-check-detail">{check.detail}</small>}
                </span>
              </li>
            ))}</ul>
          </section>}
          {trackRecord && <section className="research-fact" aria-labelledby="track-record-title">
            <h2 id="track-record-title">Track record</h2>
            <p className="research-note">Every A and B signal is recorded hourly and checked four hours later against the price. &ldquo;High probability&rdquo; appears only after {PROVEN_MIN_SIGNALS} results on {PROVEN_MIN_DAYS} different days, with the 95% range still at least {Math.round(PROVEN_MIN_LOWER_BOUND * 100)}% right.{!trackRecord.available && ' Results are not available yet.'}</p>
            <div className="research-history-table" tabIndex={0} role="region" aria-label="Signal results"><table>
              <caption>Signal results for this model version</caption>
              <thead><tr><th scope="col">Signals</th><th scope="col">Results</th><th scope="col">Right</th><th scope="col">95% range</th><th scope="col">Average move</th></tr></thead>
              <tbody>{([['All markets', trackRecord.overall], [symbol, trackRecord.bySymbol[symbol]]] as const).flatMap(([scope, grades]) => (['A', 'B'] as const).map(grade => {
                const stats = grades?.[grade];
                return <tr key={`${scope}-${grade}`}><th scope="row">{scope} / {grade}</th><td>{stats?.n ?? 0}</td>
                  <td>{stats?.hitRate == null ? '—' : `${Math.round(stats.hitRate * 100)}%`}</td>
                  <td>{stats?.interval95 ? `${Math.round(stats.interval95[0] * 100)}–${Math.round(stats.interval95[1] * 100)}%` : '—'}</td>
                  <td>{stats?.avgReturnBps == null ? '—' : `${signed(stats.avgReturnBps)} bps`}</td></tr>;
              }))}</tbody>
            </table></div>
          </section>}
          {data.alignment && <section className="research-fact" aria-labelledby="alignment-title">
            <h2 id="alignment-title">Four-hour macro alignment</h2>
            <p>{data.alignment.status.replaceAll('_', ' ')} / {data.forecast ? `separate macro signal: ${data.forecast.macroSignal?.replaceAll('_', ' ') ?? 'neutral'}` : `${data.conviction} conviction`}</p>
            <p className="research-note">Regime: {data.alignment.context.regime.replaceAll('_', ' ')}.</p>
            <p className="research-note">Market confirmation: {data.alignment.marketConfirmation ?? 'unavailable'}.</p>
            {data.alignment.reasons.length > 0 && <ul>{data.alignment.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
          </section>}
          <section className="research-fact" aria-labelledby="technical-title">
            <h2 id="technical-title">Compare with your technical setup</h2>
            <label htmlFor="technical-side">Your technical direction </label>
            <select id="technical-side" value={technicalSide} onChange={event => setTechnicalSide(event.target.value)}>
              <option value="none">Choose a direction</option><option value="long">Long / buy</option><option value="short">Short / sell</option>
            </select>
            <p role="status">{technicalSide === 'none' ? 'Choose the direction from your chart analysis.'
              : data.direction === 'neutral' ? 'Macro evidence has no directional lean to compare.'
              : (technicalSide === 'long') === data.direction.includes('bullish')
                ? `Aligned: your ${technicalSide} setup agrees with the ${biasWord(data.direction).toLowerCase()} bias (${data.conviction} conviction).`
                : `Conflict: your ${technicalSide} setup trades against the ${biasWord(data.direction).toLowerCase()} bias. Consider waiting or reducing size.`}</p>
            <p className="research-note">The bias covers fundamentals only. Your entry, stop loss and profit target come from your chart.</p>
          </section>
          <nav className="research-section-links" aria-label="Analysis sections"><a href="#market-drivers">Drivers</a><a href="#market-history">History</a>{marketFeatures.calendar && <a href="#economic-calendar">Upcoming releases</a>}</nav>
          <MarketDrivers data={data} now={now} />
          <MarketBiasHistory data={data} />
          <div className="research-facts">
            <section className="research-fact" aria-labelledby="reference-chart-title"><h2 id="reference-chart-title">Price reference</h2><a className="research-fact-link" href={reference.url} target="_blank" rel="noopener noreferrer">Open chart on TradingView</a><p className="research-note">{reference.note}</p></section>
            {response?.dxy && <section className="research-fact" aria-labelledby="dollar-context-title"><h2 id="dollar-context-title">US dollar context</h2><p className="research-figure">{response.dxy.price || 'Unavailable'}</p><p>DXY {signed(response.dxy.percentChange)}% versus its previous close ({response.dxy.status}).</p><p className="research-note">Observation from the bias input feed, fetched {new Date(response.timestamp).toLocaleString()}. Broader dollar context is not an additional score input on this page.</p></section>}
          </div>
          <div className="research-context-grid">
            {marketFeatures.calendar && <PanelErrorBoundary name="Economic calendar"><EconomicCalendar symbol={symbol} /></PanelErrorBoundary>}
            {marketFeatures.macro && <PanelErrorBoundary name="Macro context"><MacroContext /></PanelErrorBoundary>}
          </div>
          <MarketMethodology data={data} />
          <footer className="research-footer"><p>{response!.disclaimer}</p><Link href="/">Back to markets</Link></footer>
        </>}
      </main>
    </div>
  );
}
