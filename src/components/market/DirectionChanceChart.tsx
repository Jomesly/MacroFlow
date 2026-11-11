import type { DirectionChance } from '@/lib/direction-chance';

export default function DirectionChanceChart({ chance, compact = false }: { chance: DirectionChance | null; compact?: boolean }) {
  if (!chance || chance.status !== 'estimated' || chance.upPercent === null || chance.downPercent === null) {
    return <span className={`direction-chance${compact ? ' is-compact' : ''}`}><span className="chance-note">Chance unavailable</span></span>;
  }
  return (
    <span className={`direction-chance${compact ? ' is-compact' : ''}`} role="img"
      aria-label={`Estimated chance over four hours: ${chance.upPercent}% up, ${chance.downPercent}% down. Uncalibrated model estimate.`}>
      <span className="chance-labels" aria-hidden="true"><span>Up <b>{chance.upPercent}%</b></span><span>Down <b>{chance.downPercent}%</b></span></span>
      <span className="chance-track" aria-hidden="true">
        <span className="chance-up" style={{ width: `${chance.upPercent}%` }} />
        <span className="chance-down" style={{ width: `${chance.downPercent}%` }} />
      </span>
      <span className="chance-note" aria-hidden="true">{compact ? '4h estimate · uncalibrated' : 'Next four hours · model estimate, not a measured win rate'}</span>
    </span>
  );
}
