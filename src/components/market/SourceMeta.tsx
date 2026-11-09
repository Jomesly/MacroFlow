'use client';

import type { ResourceMeta } from '@/lib/market/types';

export function resourceExpired(meta: ResourceMeta, now: number) {
  return meta.staleUntil !== null && Date.parse(meta.staleUntil) <= now;
}

export default function SourceMeta({ meta, daily = false, now }: { meta: ResourceMeta; daily?: boolean; now: number }) {
  const stale = meta.status === 'stale' || (meta.freshUntil !== null && Date.parse(meta.freshUntil) <= now);
  const unavailable = meta.status === 'unavailable' || resourceExpired(meta, now);
  return (
    <p className="market-source-meta">
      <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">{meta.provider}</a>
      {' · '}{unavailable ? 'Unavailable' : stale ? 'Stale cache' : meta.status === 'empty' ? 'No events' : 'Cached'}
      {meta.observedAt && <> · {daily ? 'Observation ' + meta.observedAt.slice(0, 10) : 'Observed ' + new Date(meta.observedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</>}
      {meta.delayed && <> · {daily ? 'Daily data' : 'Delayed / indicative'}</>}
      {meta.fetchedAt && <span className="market-source-fetch">Fetched {new Date(meta.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</span>}
    </p>
  );
}
