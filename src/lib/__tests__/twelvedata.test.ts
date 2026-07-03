import { describe, expect, it } from 'vitest';
import { classifyDxyMove, classifyYieldMove } from '../api/twelvedata';

describe('market data thresholds', () => {
  it('ignores small DXY moves', () => {
    expect(classifyDxyMove(0.05)).toBeNull();
    expect(classifyDxyMove(-0.05)).toBeNull();
  });

  it('classifies meaningful DXY moves', () => {
    expect(classifyDxyMove(0.25)).toBe('strong');
    expect(classifyDxyMove(-0.25)).toBe('weak');
  });

  it('ignores small yield moves and classifies moves above 3bps', () => {
    expect(classifyYieldMove(0.02)).toBeNull();
    expect(classifyYieldMove(-0.02)).toBeNull();
    expect(classifyYieldMove(0.03)).toBe('rising');
    expect(classifyYieldMove(-0.03)).toBe('falling');
  });
});
