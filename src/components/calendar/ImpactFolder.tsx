import type { CalendarImpact } from '@/lib/types';

export const IMPACT_STYLE: Record<CalendarImpact, { color: string; label: string }> = {
  high: { color: 'text-red-500', label: 'High impact' },
  medium: { color: 'text-orange-500', label: 'Medium impact' },
  low: { color: 'text-yellow-500', label: 'Low impact' },
  holiday: { color: 'text-zinc-500', label: 'Holiday' },
};

/** Impact folder: colour plus an accessible label, so impact never relies on colour alone. */
export default function ImpactFolder({ impact, className = 'w-4 h-3.5' }: { impact: CalendarImpact; className?: string }) {
  const { color, label } = IMPACT_STYLE[impact];
  return (
    <svg viewBox="0 0 16 13" className={`${className} ${color} shrink-0`} role="img" aria-label={label}>
      <title>{label}</title>
      <path fill="currentColor" d="M1 2.2C1 1.5 1.5 1 2.2 1h3.6l1.6 1.8h6.4c.7 0 1.2.5 1.2 1.2v6.8c0 .7-.5 1.2-1.2 1.2H2.2C1.5 12 1 11.5 1 10.8z" />
    </svg>
  );
}
