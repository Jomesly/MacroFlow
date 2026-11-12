import { ArrowDownRight, ArrowUpRight } from '@phosphor-icons/react';
import type { MarketFactor } from '@/lib/market-factors';

/** Bullish and bearish factors that may move the chart, for pairing with technical analysis. */
export default function FactorList({ factors, detailed = false, empty = 'No fresh news or macro factors.' }: {
  factors: MarketFactor[];
  /** Market pages also show where each factor came from. */
  detailed?: boolean;
  empty?: string;
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
              <span className="factor-title">{factor.title}{detailed ? <span className="factor-source"> · {factor.kind === 'news' ? 'News' : 'Data'}{factor.source ? `, ${factor.source}` : ''}</span> : null}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
