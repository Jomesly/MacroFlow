import { describe, expect, it } from 'vitest';
import { gradeBadge, gradeSignal, signalFromGrade } from '../signal-grade';
import { unknownContext } from '../macro-context';
import type { AlignmentAssessment, BiasResult, CalendarEvent, ScoredEvent } from '../types';

const asOf = '2026-11-23T09:00:00.000Z';
const at = (hours: number) => new Date(Date.parse(asOf) + hours * 3_600_000).toISOString();
const headline = (id: string, scoreChange: number, sourceName: string, hoursAgo: number): ScoredEvent => ({
  id, category: 'asset_sentiment', title: id, description: id, impact: 'medium', scoreChange, sourceName,
  evidenceType: 'headline', timestamp: at(-hoursAgo),
});

/** GBPUSD with every A-signal check passing; `sign` mirrors it to bearish. */
function base(sign: 1 | -1 = 1): BiasResult {
  return {
    symbol: 'GBPUSD', name: 'British Pound / US Dollar', biasScore: 55 * sign, biasPercent: 55 * sign,
    direction: sign > 0 ? 'bullish' : 'bearish', strength: 'strong', conviction: 'high', signal: sign > 0 ? 'strong_buy' : 'strong_sell',
    dailyLabel: '', drivers: [], confirmationRatio: 100, eventCount: 3, confidenceCount: 2, totalPossibleSignals: 2, history: [], lastUpdated: asOf,
    events: [
      headline('reuters', 20 * sign, 'Reuters', 1),
      headline('fxstreet', 15 * sign, 'FXStreet', 2),
      { id: 'us-trend', category: 'inflation', country: 'US', title: 'US trend', description: 'US trend', impact: 'high', scoreChange: 5 * sign, evidenceType: 'trend', timestamp: at(-3) },
      { id: 'gb-trend', category: 'inflation', country: 'GB', title: 'UK trend', description: 'UK trend', impact: 'high', scoreChange: 5 * sign, evidenceType: 'trend', timestamp: at(-3) },
      { id: 'dxy', category: 'dollar_strength', country: 'US', title: 'Dollar observation', description: 'Dollar observation', impact: 'medium', scoreChange: 5 * sign, evidenceType: 'market', timestamp: at(-1) },
      { id: 'yield', category: 'yields', country: 'US', title: 'Yield observation', description: 'Yield observation', impact: 'medium', scoreChange: 5 * sign, evidenceType: 'market', timestamp: at(-1) },
    ],
    alignment: { modelVersion: 'test', horizonHours: 4, status: 'aligned', marketConfirmation: 'confirming', reasons: [],
      context: { ...unknownContext(asOf), complete: true }, probability: null, validation: 'unvalidated' },
    forecast: { modelVersion: 'test', horizonHours: 4, issuedAt: asOf, expiresAt: at(4), basis: 'mixed',
      components: { news: { score: 50 * sign, weight: 0.7 }, macro: { score: 12 * sign, weight: 0.3 } },
      summary: '', limitations: [], sourceCount: 2, latestEvidenceAt: at(-1), latestNewsAt: at(-1), macroBiasScore: 20 * sign, probability: null },
  };
}
const ctx = { asOf, calendar: [] as CalendarEvent[], calendarVerified: true, inputsHealthy: true };
const release = (hoursAhead: number, impact: CalendarEvent['impact'], affects: string[]): CalendarEvent => ({
  id: 'cpi', title: 'CPI', currency: 'USD', time: at(hoursAhead), impact, forecast: null, previous: null, actual: null, affects,
});
const forecast = (r: BiasResult, patch: Partial<NonNullable<BiasResult['forecast']>>): BiasResult => ({ ...r, forecast: { ...r.forecast!, ...patch } });
const confirmation = (r: BiasResult, marketConfirmation: AlignmentAssessment['marketConfirmation']): BiasResult =>
  ({ ...r, alignment: { ...r.alignment!, marketConfirmation } });
const grade = (r: BiasResult, extra: Partial<typeof ctx> = {}) => gradeSignal(r, { ...ctx, ...extra }).grade;

describe('macro-matched signal grade', () => {
  it('gives an A signal when every check passes', () => {
    const result = gradeSignal(base(), ctx);
    expect(result).toMatchObject({ grade: 'A', side: 'long' });
    expect(result.checks).toHaveLength(7);
    expect(result.checks.every(check => check.passed)).toBe(true);
  });
  it('mirrors to a short A signal', () => expect(gradeSignal(base(-1), ctx)).toMatchObject({ grade: 'A', side: 'short' }));
  it('drops to B when dollar and yield moves are flat', () => expect(grade(confirmation(base(), 'flat'))).toBe('B'));
  it('cannot claim dollar and yield confirmation from only one observed market', () => {
    expect(grade({ ...base(), events: base().events.filter(event => event.category !== 'yields') })).toBe('B');
  });
  it('does not claim confirmation when the yield observation opposes the direction', () => {
    expect(grade({ ...base(), events: base().events.map(event => event.category === 'yields'
      ? { ...event, scoreChange: -5 } : event) })).toBe('B');
  });
  it('gives no signal when two optional checks fail', () => {
    const single = { ...confirmation(base(), 'flat'), events: base().events.map(e => ({ ...e, sourceName: 'Reuters' })) };
    expect(grade(single)).toBe('none');
  });
  it('needs the macro backdrop to point the same way', () =>
    expect(grade(forecast(base(), { components: { news: { score: 50, weight: 0.7 }, macro: { score: -12, weight: 0.3 } } }))).toBe('none'));
  it('cannot treat a US-only backdrop as complete UK macro support', () => {
    const result = gradeSignal({ ...base(), events: base().events.filter(event => event.country !== 'GB') }, ctx);
    expect(result.grade).toBe('none');
    expect(result.checks.find(check => check.id === 'macro_match')?.detail).toContain('United Kingdom');
  });
  it('requires the domestic structured data to support the pair direction too', () => {
    const result = { ...base(), events: base().events.map(event => event.country === 'GB'
      ? { ...event, scoreChange: -5 } : event) };
    expect(grade(result)).toBe('none');
  });
  it('does not accept an incomplete economic context as macro confirmation', () => {
    const result = { ...base(), alignment: { ...base().alignment!, context: unknownContext(asOf) } };
    expect(grade(result)).toBe('none');
  });
  it('withholds a signal unless calendar coverage is explicitly verified', () => {
    expect(gradeSignal(base(), { ...ctx, calendarVerified: undefined }).grade).toBe('none');
  });
  it('stands aside before a high-impact release for this market', () =>
    expect(grade(base(), { calendar: [release(3, 'high', ['GBPUSD'])] })).toBe('none'));
  it('ignores a release after the 4-hour window', () => expect(grade(base(), { calendar: [release(5, 'high', ['GBPUSD'])] })).toBe('A'));
  it('ignores a release for another market', () => expect(grade(base(), { calendar: [release(3, 'high', ['USDJPY'])] })).toBe('A'));
  it('ignores a medium-impact release', () => expect(grade(base(), { calendar: [release(1, 'medium', ['GBPUSD'])] })).toBe('A'));
  it('needs news from the last 6 hours', () => {
    const stale = { ...forecast(base(), { latestNewsAt: at(-7) }), events: base().events.map(e => e.evidenceType === 'headline' ? { ...e, timestamp: at(-7) } : e) };
    expect(grade(stale)).toBe('none');
  });
  it('needs news at all', () => expect(grade(forecast(base(), { latestNewsAt: null }))).toBe('none'));
  it('never counts future-dated news as fresh', () => {
    const future = { ...forecast(base(), { latestNewsAt: at(1) }), events: base().events.map(e => e.evidenceType === 'headline' ? { ...e, timestamp: at(1) } : e) };
    expect(grade(future)).toBe('none');
  });
  it('needs 70% of the evidence to agree', () =>
    expect(grade({ ...base(), events: [...base().events, headline('opposing', -30, 'Bloomberg', 1)] })).toBe('none'));
  it('gives no signal below a score of 30', () =>
    expect(gradeSignal({ ...base(), biasScore: 29, biasPercent: 29, direction: 'weakly_bullish' }, ctx)).toMatchObject({ grade: 'none', side: null }));
  it('gives no signal when inputs are unhealthy', () => expect(grade(base(), { inputsHealthy: false })).toBe('none'));
});

describe('grade badge', () => {
  it.each([
    [{ grade: 'A' as const, side: 'long' as const, checks: [] }, 'A signal · Long'],
    [{ grade: 'B' as const, side: 'short' as const, checks: [] }, 'B signal · Short'],
    [{ grade: 'none' as const, side: null, checks: [] }, 'Lean only'],
    [undefined, 'Lean only'],
  ])('%j -> %s', (graded, badge) => expect(gradeBadge(graded)).toBe(badge));
});

describe('trade signal from grade', () => {
  it.each([
    [{ grade: 'A' as const, side: 'long' as const, checks: [] }, 'strong_buy'],
    [{ grade: 'B' as const, side: 'short' as const, checks: [] }, 'sell'],
    [{ grade: 'none' as const, side: null, checks: [] }, 'neutral'],
  ])('%j -> %s', (graded, signal) => expect(signalFromGrade(graded)).toBe(signal));
});
