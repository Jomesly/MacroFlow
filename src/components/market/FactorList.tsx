import { ArrowDownRight, ArrowUpRight } from '@phosphor-icons/react';
import type { MarketFactor } from '@/lib/market-factors';
import { ageLabel } from '@/lib/freshness';

/** Bullish and bearish factors that may move the chart, for pairing with technical analysis. */
export default function FactorList({ factors, detailed = false, empty = 'No fresh news or macro factors.', now = 0 }: {
  factors: MarketFactor[];
  /** Market pages also show where each factor came from. */
  detailed?: boolean;
  empty?: string;
  /** Client clock in ms; 0 during server rendering, when ages are left out. */
  now?: number;
}) {
  if (!factors.length) return <p className="factor-empty">{empty}</p>;
  return (
    <ul className={`factor-list${detailed ? ' is-detailed' : ''}`}>
      {factors.map(factor => {
        const Icon = factor.side === 'bullish' ? ArrowUpRight : ArrowDownRight;
        return (
          <li key={factor.id} className={`factor is-${factor.side}`}>
            <Icon size={13} weight="bold" aria-hidden="true" className="factor-icon" />
            <span className="factor-body">
              <span className="factor-reason"><span className="sr-only">{factor.side === 'bullish' ? 'Bullish: ' : 'Bearish: '}</span>{factor.reason}</span>
              <span className="factor-title">{factor.title}{detailed ? <span className="factor-source"> · {factor.kind === 'news' ? 'News' : 'Data'}{factor.source ? `, ${factor.source}` : ''}{now > 0 && factor.timestamp ? <> · <time dateTime={factor.timestamp}>{ageLabel(factor.timestamp, new Date(now).toISOString())}</time></> : null}</span> : null}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
