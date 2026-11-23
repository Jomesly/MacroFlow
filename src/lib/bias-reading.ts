import type { BiasResult } from './types';

export const HIGH_CONVICTION_PERCENT = 50;

/** Also enforce the invariant on older API payloads retained during a rollout. */
export function consistentBiasReading(result: BiasResult): BiasResult {
  // A graded read's conviction comes from its signal checks, which set their own score floor.
  if (result.grade) return result;
  if (result.conviction !== 'high' || (Number.isFinite(result.biasPercent)
    && Math.abs(result.biasPercent) >= HIGH_CONVICTION_PERCENT)) return result;
  return { ...result, conviction: 'low', signal: 'neutral',
    ...(result.alignment && { alignment: { ...result.alignment,
      status: result.alignment.status === 'aligned' ? 'conflicted' : result.alignment.status,
      reasons: [...result.alignment.reasons, 'Displayed bias strength does not meet the 50% high-conviction minimum.'],
    } }),
  };
}
