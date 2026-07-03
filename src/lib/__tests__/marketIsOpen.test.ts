import { describe, it, expect } from 'vitest';
import { marketIsOpen } from '../marketIsOpen';

describe('marketIsOpen', () => {
  it('BTCUSD is always open', () => {
    // Sunday — closed for everything else, open for BTC
    const sunday = new Date('2026-07-05T12:00:00Z');
    expect(marketIsOpen('BTCUSD', sunday)).toBe(true);
  });

  it('returns false on weekends', () => {
    const sunday = new Date('2026-07-05T12:00:00Z'); // Sunday
    const saturday = new Date('2026-07-04T12:00:00Z'); // Saturday
    expect(marketIsOpen('XAUUSD', sunday)).toBe(false);
    expect(marketIsOpen('GBPUSD', saturday)).toBe(false);
  });

  it('returns true on regular trading weekdays', () => {
    const monday = new Date('2026-07-06T12:00:00Z'); // Monday
    expect(marketIsOpen('US100', monday)).toBe(true);
  });

  it('returns false on US market holidays', () => {
    // July 3, 2026 — Independence Day observed (Friday)
    const independenceDay = new Date('2026-07-03T12:00:00Z');
    expect(marketIsOpen('XAUUSD', independenceDay)).toBe(false);
    expect(marketIsOpen('DJ30', independenceDay)).toBe(false);
    // BTCUSD不受假期影响
    expect(marketIsOpen('BTCUSD', independenceDay)).toBe(true);
  });

  it('returns true on weekdays that are not holidays', () => {
    // July 2, 2026 — Thursday, not a holiday
    const regularThursday = new Date('2026-07-02T12:00:00Z');
    expect(marketIsOpen('GBPUSD', regularThursday)).toBe(true);
  });
});
