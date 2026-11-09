'use client';

import { ChartLine } from '@phosphor-icons/react';
import type { MacroContextData } from '@/lib/market/types';
import SourceMeta, { resourceExpired } from './SourceMeta';
import { useMarketResource } from './useMarketResource';
import { useMarketClock } from './useMarketClock';

const readings = [
  ['treasury2y', 'US 2-year yield', 'Daily Treasury constant maturity yield.'],
  ['treasury10y', 'US 10-year yield', 'Daily Treasury constant maturity yield.'],
  ['spread', '10Y − 2Y spread', 'Difference in basis points, using matching observation dates.'],
] as const;

export default function MacroContext() {
  const { data, loading, error, refresh } = useMarketResource<MacroContextData>('/api/macro-context');
  const now = useMarketClock();
  return (
    <section className="context-panel macro-context" aria-labelledby="macro-context-title">
      <div className="context-heading"><ChartLine size={20} aria-hidden="true" /><h2 id="macro-context-title">Macro context</h2><button className="market-panel-retry" disabled={loading} onClick={() => void refresh()}>{loading ? 'Updating context' : 'Refresh context'}</button></div>
      <p className="market-panel-note">Market observations for context. These readings do not add new bias signals.</p>
      {error && <p className="market-panel-note" role="alert">Context refresh failed. Displayed data may be outdated.</p>}
      {loading && !data ? <p className="market-panel-note" role="status">Loading macro observations…</p> : !data ? <p className="market-panel-note">Macro context is unavailable. Try refreshing.</p> : (
        <dl className="macro-readings">{readings.map(([key, label, description]) => {
          const resource = data[key];
          const value = resourceExpired(resource.meta, now) ? null : resource.data;
          return <div key={key} className="macro-reading">
            <dt>{label}</dt>
            <dd className="macro-value">{value ? <>{value.value.toFixed(2)}{value.unit === 'percent' ? '%' : value.unit === 'basis-points' ? ' bps' : ''}{value.changePercent !== undefined && <span>{value.changePercent >= 0 ? '+' : ''}{value.changePercent.toFixed(2)}% vs previous close</span>}</> : 'Unavailable'}</dd>
            <dd className="macro-description">{description}</dd><dd><SourceMeta meta={resource.meta} daily now={now} /></dd>
          </div>;
        })}</dl>
      )}
    </section>
  );
}
