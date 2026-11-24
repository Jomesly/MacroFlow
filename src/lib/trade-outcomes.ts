/** Plain outcome counts shared by journal summaries, calendars and tooltips. */
export function formatTradeOutcomes(wins: number, losses: number, breakeven = 0): string {
  const parts = [
    `${wins} ${wins === 1 ? 'win' : 'wins'}`,
    `${losses} ${losses === 1 ? 'loss' : 'losses'}`,
  ];
  if (breakeven > 0) parts.push(`${breakeven} break-even`);
  return parts.join(' · ');
}
