import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { Trade } from '../types';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  account: vi.fn(),
  shots: vi.fn(),
  counts: vi.fn(),
  features: { screenshots: true },
}));
vi.mock('../auth', () => ({ requireJournalAccess: h.auth }));
vi.mock('../journal', () => ({ listTrades: h.list }));
vi.mock('../trading-accounts', () => ({ requireOwnedTradingAccount: h.account }));
vi.mock('../screenshots', () => ({ screenshotsForTrades: h.shots, screenshotCountsByTrade: h.counts }));
vi.mock('../journal-features', () => ({ journalFeatures: h.features }));

import { isCalendarDate, tradesOnDay } from '../day-trades';
import { GET as dayRoute } from '../../app/api/journal/day/route';
import { GET as analyticsRoute } from '../../app/api/journal/analytics/route';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function trade(n: number, overrides: Partial<Trade> = {}): Trade {
  return {
    id: ID(n), timestamp: '2026-11-18T09:00:00.000Z', closedAt: '2026-11-18T15:00:00.000Z',
    symbol: 'XAUUSD', direction: 'long', entryPrice: 1, exitPrice: 2, result: 'win',
    pnlPercent: null, pnlAmount: 50, rMultiple: 1.5, brokerAccountId: null,
    journalAccountId: 'acct-1', setupTags: ['Sweep'], notes: '',
    ...overrides,
  };
}
const shot = (tradeN: number, slot: number) => ({
  id: ID(100 + tradeN * 10 + slot), slot: String(slot), clientUploadId: 'c', createdAt: '2026-11-18T15:00:00Z',
  url: `/api/journal/trade/${ID(tradeN)}/screenshots?imageId=${ID(100 + tradeN * 10 + slot)}`,
  mimeType: 'image/png', byteSize: 10, width: 1600, height: 900,
});
const day = (query: string) => dayRoute(new NextRequest(`http://localhost:3000/api/journal/day?${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  h.features.screenshots = true;
  h.auth.mockResolvedValue({ ok: true, userId: 'owner' });
  h.account.mockResolvedValue({ currency: 'USD' });
  h.shots.mockResolvedValue(new Map());
  h.counts.mockResolvedValue(new Map());
});

describe('isCalendarDate', () => {
  it('accepts real days only', () => {
    expect(isCalendarDate('2026-11-18')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    for (const bad of [null, '', '2026-02-30', '2026-13-01', '2026-1-01', '2026-11-18T00:00', '18/11/2026']) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });
});

describe('tradesOnDay', () => {
  it('uses the calendar day rule: close date, else log date; open trades excluded', () => {
    const closedNextDay = trade(1, { timestamp: '2026-11-17T22:00:00Z', closedAt: '2026-11-18T01:00:00Z' });
    const openedToday = trade(2, { closedAt: '2026-11-19T10:00:00Z' });
    const loggedToday = trade(3, { closedAt: null });
    const stillOpen = trade(4, { result: null, closedAt: null });
    const later = trade(5, { closedAt: '2026-11-18T20:00:00Z' });
    expect(tradesOnDay([later, openedToday, stillOpen, loggedToday, closedNextDay], '2026-11-18').map(t => t.id))
      .toEqual([ID(1), ID(3), ID(5)]);
  });
  it('places date-only imports on their source-timezone day', () => {
    const imported = trade(1, {
      timestamp: '2026-11-18T05:00:00Z', closedAt: '2026-11-18T05:00:00Z',
      importInfo: { dateMeaning: 'close', datePrecision: 'date', closedPrecision: 'date', sourceDate: '2026-11-18', timezone: 'Asia/Manila', sourceClosedDate: '2026-11-18' },
    });
    expect(tradesOnDay([imported], '2026-11-18')).toHaveLength(1);
  });
});

describe('GET /api/journal/day', () => {
  it('requires journal access before reading trades', async () => {
    h.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Sign in' }, { status: 401 }) });
    expect((await day('date=2026-11-18')).status).toBe(401);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid date before any database read', async () => {
    for (const query of ['', 'date=2026-02-30', 'date=tomorrow']) expect((await day(query)).status).toBe(400);
    expect(h.list).not.toHaveBeenCalled();
  });

  it("returns only that day's closed trades with their screenshots, scoped to the owner", async () => {
    h.list.mockResolvedValue([trade(1), trade(2, { closedAt: '2026-11-19T15:00:00Z' }), trade(3, { symbol: 'EURUSD' })]);
    h.shots.mockResolvedValue(new Map([[ID(1), [shot(1, 0), shot(1, 1)]]]));
    const res = await day('date=2026-11-18&tradingAccount=acct-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(h.list).toHaveBeenCalledWith('owner', 'acct-1');
    expect(h.shots).toHaveBeenCalledWith('owner', [ID(1), ID(3)]);
    const body = await res.json();
    expect(body).toMatchObject({ date: '2026-11-18', screenshots: 'ready', moneyComparable: true, currency: 'USD' });
    expect(body.trades.map((t: { id: string }) => t.id)).toEqual([ID(1), ID(3)]);
    expect(body.trades[0].screenshots).toEqual([
      { id: shot(1, 0).id, slot: '0', url: shot(1, 0).url, width: 1600, height: 900 },
      { id: shot(1, 1).id, slot: '1', url: shot(1, 1).url, width: 1600, height: 900 },
    ]);
    expect(body.trades[1].screenshots).toEqual([]);
    // Storage internals never reach the browser.
    expect(JSON.stringify(body)).not.toMatch(/object_path|clientUploadId|user_id/);
  });

  it('applies the analytics filters so the day matches its calendar cell', async () => {
    h.list.mockResolvedValue([trade(1), trade(2, { symbol: 'EURUSD' })]);
    const body = await (await day('date=2026-11-18&symbol=EURUSD')).json();
    expect(body.trades.map((t: { id: string }) => t.id)).toEqual([ID(2)]);
  });

  it('hides cash when the view mixes accounts, like the analytics summary', async () => {
    h.list.mockResolvedValue([trade(1), trade(2, { journalAccountId: 'acct-2' })]);
    const body = await (await day('date=2026-11-18')).json();
    expect(body.moneyComparable).toBe(false);
    expect(body.trades.every((t: { pnlAmount: number | null }) => t.pnlAmount === null)).toBe(true);
  });

  it('still lists trades when screenshots cannot be loaded', async () => {
    h.list.mockResolvedValue([trade(1)]);
    h.shots.mockRejectedValue(new Error('storage down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await day('date=2026-11-18');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.screenshots).toBe('unavailable');
    expect(body.trades).toHaveLength(1);
  });

  it('skips screenshot reads when the feature is off', async () => {
    h.features.screenshots = false;
    h.list.mockResolvedValue([trade(1)]);
    const body = await (await day('date=2026-11-18')).json();
    expect(body.screenshots).toBe('disabled');
    expect(h.shots).not.toHaveBeenCalled();
  });
});

describe('GET /api/journal/analytics calendar screenshot counts', () => {
  const analytics = () => analyticsRoute(new NextRequest('http://localhost:3000/api/journal/analytics'));

  it('adds per-day screenshot counts for closed trades', async () => {
    h.list.mockResolvedValue([trade(1), trade(2), trade(3, { closedAt: '2026-11-19T10:00:00Z' }), trade(4, { result: null, closedAt: null })]);
    h.counts.mockResolvedValue(new Map([[ID(1), 2], [ID(2), 1], [ID(4), 3]]));
    const body = await (await analytics()).json();
    const days = Object.fromEntries(body.analytics.calendar.map((d: { date: string; screenshots?: number }) => [d.date, d.screenshots]));
    expect(days).toEqual({ '2026-11-18': 3, '2026-11-19': undefined });
    expect(h.counts).toHaveBeenCalledWith('owner');
  });

  it('keeps analytics working when screenshot counts fail', async () => {
    h.list.mockResolvedValue([trade(1)]);
    h.counts.mockRejectedValue(new Error('storage down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await analytics();
    expect(res.status).toBe(200);
    expect((await res.json()).analytics.calendar[0].screenshots).toBeUndefined();
  });
});
