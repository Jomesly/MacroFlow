'use client';

import Link from 'next/link';
import type { AssetSymbol, BiasApiResponse } from '@/lib/types';
import { referenceCharts } from '@/lib/market/instruments';
import { directionLabel, marketSymbols, signed } from '@/lib/market/symbols';
import { marketIsOpen } from '@/lib/marketIsOpen';
import { marketFeatures } from '@/lib/market/features';
import { useMarketResource } from './useMarketResource';
import { useMarketClock } from './useMarketClock';
import { MarketBiasHistory, MarketDrivers, MarketMethodology } from './MarketAnalysis';
import EconomicCalendar from './EconomicCalendar';
import MacroContext from './MacroContext';
import PanelErrorBoundary from './PanelErrorBoundary';

export default function MarketDetailPage({ symbol }: { symbol: AssetSymbol }) {
  const { data: response, loading, error, refresh } = useMarketResource<BiasApiResponse>(`/api/bias?symbol=${symbol}`, 900_000);
  const now = useMarketClock();
  const data = response?.data.find((entry) => entry.symbol === symbol);
  const reference = referenceCharts[symbol];
  const degraded = response?.sourceHealth && Object.values(response.sourceHealth).some((status) => status === 'failed');
  return (
    <div className="market-research">
      <header className="research-navigation">
        <Link href="/" className="research-back">Back to markets</Link>
        <span>MacroFlow</span>
      </header>
      <nav className="research-markets" aria-label="Choose a market">
        {marketSymbols.map((market) => <Link key={market} href={`/markets/${market}`} aria-current={market === symbol ? 'page' : undefined} title={referenceCharts[market].name}>{market}</Link>)}
      </nav>
      <main id="main-content">
        <header className="research-heading">
          <div><h1>{symbol}</h1><p>{reference.name}</p></div>
          <button type="button" className="research-action" onClick={() => void refresh()} disabled={loading}>{loading ? 'Updating analysis' : 'Refresh analysis'}</button>
        </header>
        {error && <p role="alert" className="research-notice">Analysis could not be refreshed. {data ? 'The last successful read is shown below and may be outdated.' : 'Try refreshing the analysis.'}</p>}
        {loading && !response && <div className="research-loading" role="status"><span>Loading {symbol} analysis</span><div /><div /><div /></div>}
        {!loading && !data && <p className="research-empty">Analysis for {symbol} is unavailable. Use Refresh analysis to try again, or choose another market.</p>}
        {data && <>
          <section className={`research-read research-read-${data.direction.includes('bullish') ? 'positive' : data.direction.includes('bearish') ? 'negative' : 'neutral'}`} aria-label="Current market bias">
            <div className="research-bias"><p>Fundamental bias</p><strong>{signed(data.biasPercent)}<span>%</span></strong><p>{directionLabel(data.direction)}</p></div>
            <div className="research-assessment">
              <p>{data.direction === 'neutral' ? 'No dominant fundamental direction in this read.' : `The scored evidence is ${directionLabel(data.direction)} with ${data.conviction} conviction.`}</p>
              <p className="research-note">A normalized bias score, not a price change or a win probability.</p>
              <dl><div><dt>Conviction</dt><dd>{data.conviction}</dd></div><div><dt>Session</dt><dd>{marketIsOpen(symbol, new Date(now)) ? 'Market open' : 'Market closed'}</dd></div></dl>
            </div>
          </section>
          <div className="research-freshness" aria-live="polite">
            <p>Calculated <time dateTime={data.lastUpdated}>{new Date(data.lastUpdated).toLocaleString()}</time></p>
            <p>Source mode: {response!.source}. {error || response!.stale ? 'Outdated read.' : 'Latest available read.'}{degraded && ' Some providers are unavailable.'}{response!.source === 'baseline' && ' Baseline inputs; live confirmation is unavailable.'}</p>
            <p>Inputs fetched <time dateTime={response!.timestamp}>{new Date(response!.timestamp).toLocaleString()}</time></p>
          </div>
          <nav className="research-section-links" aria-label="Analysis sections"><a href="#market-drivers">Drivers</a><a href="#market-history">History</a>{marketFeatures.calendar && <a href="#economic-calendar">Upcoming releases</a>}</nav>
          <div className="research-analysis-grid">
            <MarketDrivers data={data} />
            <aside aria-label="History and reference chart">
              <MarketBiasHistory data={data} />
              <section className="research-reference" aria-labelledby="reference-chart-title"><h2 id="reference-chart-title">Price reference</h2><a href={reference.url} target="_blank" rel="noopener noreferrer">Open chart on TradingView</a><p className="research-note">{reference.note}</p></section>
            </aside>
          </div>
          <div className="research-context-grid">
            {marketFeatures.calendar && <PanelErrorBoundary name="Economic calendar"><EconomicCalendar symbol={symbol} /></PanelErrorBoundary>}
            {marketFeatures.macro && <PanelErrorBoundary name="Macro context"><MacroContext /></PanelErrorBoundary>}
          </div>
          {response?.dxy && <section className="research-dollar" aria-labelledby="dollar-context-title"><h2 id="dollar-context-title">US dollar context</h2><p>DXY {response.dxy.price || 'value unavailable'}: {signed(response.dxy.percentChange)}% versus its previous close ({response.dxy.status}).</p><p className="research-note">Observation from the bias input feed, fetched {new Date(response.timestamp).toLocaleString()}. Broader dollar context is not an additional score input on this page.</p></section>}
          <MarketMethodology data={data} />
          <footer className="research-footer"><p>{response!.disclaimer}</p><Link href="/">Back to markets</Link></footer>
        </>}
      </main>
    </div>
  );
}
