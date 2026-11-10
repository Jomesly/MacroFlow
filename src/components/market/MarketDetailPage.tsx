'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from '@phosphor-icons/react';
import type { AssetSymbol, BiasApiResponse } from '@/lib/types';
import { referenceCharts } from '@/lib/market/instruments';
import { directionLabel, marketSymbols, signed } from '@/lib/market/symbols';
import { marketIsOpen } from '@/lib/marketIsOpen';
import { marketFeatures } from '@/lib/market/features';
import { useMarketResource } from './useMarketResource';
import { useMarketClock } from './useMarketClock';
import { MarketBiasAxis, MarketBiasHistory, MarketDrivers, MarketMethodology } from './MarketAnalysis';
import EconomicCalendar from './EconomicCalendar';
import MacroContext from './MacroContext';
import PanelErrorBoundary from './PanelErrorBoundary';
import { currentProbabilityReading, displayedProbability, probabilityText } from '@/lib/probability/presentation';

export default function MarketDetailPage({ symbol }: { symbol: AssetSymbol }) {
  const [technicalSide, setTechnicalSide] = useState('none');
  const { data: response, loading, error, refresh } = useMarketResource<BiasApiResponse>(`/api/bias?symbol=${symbol}`, 300_000);
  const now = useMarketClock();
  const rawData = response?.data.find((entry) => entry.symbol === symbol);
  const blocked = error || !!response?.stale || response?.source !== 'live' || Object.values(response?.sourceHealth ?? {}).includes('failed');
  const data = rawData ? currentProbabilityReading(rawData, blocked, now) : undefined;
  const reference = referenceCharts[symbol];
  const probability = data ? displayedProbability(data) : null;
  const degraded = response?.sourceHealth && Object.values(response.sourceHealth).some((status) => status === 'failed');
  const tone = data?.direction.includes('bullish') ? 'positive' : data?.direction.includes('bearish') ? 'negative' : 'neutral';
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
              <p>Four-hour direction probability</p>
              <strong aria-label={probability === null ? 'Probability unavailable' : `${probabilityText(data)} probability of a ${data.probability?.direction === 'up' ? 'rise' : 'fall'}`}>{probability === null ? '—' : <>{(probability * 100).toFixed(1)}<span>%</span></>}</strong>
              <p className="research-direction"><DirectionIcon size={24} weight="bold" aria-hidden="true" />{directionLabel(data.direction)}</p>
            </div>
            <div className="research-assessment">
              <p>{probability === null ? 'Probability unavailable' : `Estimated chance of price finishing ${data.probability?.direction === 'up' ? 'higher' : 'lower'} after a four-hour holding period.`}</p>
              <p className="research-note">{data.probability?.reason ?? 'A validated probability model is not available for this reading.'}</p>
              <p className="research-note">The four-hour window starts at the next hourly bar open after the reading. This measures price direction before trading costs. Your entry, stop-loss, target and technical setup are not part of this probability.</p>
              <dl>
                <div><dt>Market confirmation</dt><dd>{data.alignment?.marketConfirmation ?? 'Unavailable'}</dd></div>
                <div><dt>Validation outcomes</dt><dd>{data.probability?.validationSamples ?? 0}</dd></div>
                <div><dt>Scored events</dt><dd>{data.eventCount}</dd></div>
                <div><dt>Session</dt><dd>{marketIsOpen(symbol, new Date(now)) ? 'Market open' : 'Market closed'}</dd></div>
              </dl>
            </div>
            <MarketBiasAxis data={data} />
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
          {data.alignment && <section className="research-fact" aria-labelledby="alignment-title">
            <h2 id="alignment-title">Four-hour macro alignment</h2>
            <p>{data.alignment.status.replaceAll('_', ' ')} · {probability === null ? 'probability unavailable' : 'probability validated on separate historical outcomes'}</p>
            <p className="research-note">Regime: {data.alignment.context.regime.replaceAll('_', ' ')}.</p>
            {probability !== null && data.probability?.interval95 && <p>Estimated range: {(data.probability.interval95[0] * 100).toFixed(1)}–{(data.probability.interval95[1] * 100).toFixed(1)}% (approximate 95% interval).</p>}
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
              : (technicalSide === 'long') === data.direction.includes('bullish') ? 'Your technical direction matches the macro lean.' : 'Your technical direction opposes the macro lean.'}</p>
            <p className="research-note">{probability === null ? 'There is not enough validated evidence to attach a probability to this setup.' : 'Matching direction does not establish the win rate of your technical setup.'}</p>
          </section>
          <nav className="research-section-links" aria-label="Analysis sections"><a href="#market-drivers">Drivers</a><a href="#market-history">History</a>{marketFeatures.calendar && <a href="#economic-calendar">Upcoming releases</a>}</nav>
          <MarketDrivers data={data} />
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
