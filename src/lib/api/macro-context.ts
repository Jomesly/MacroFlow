import 'server-only';
import { z } from 'zod';
import { providerFetch } from '../market/http';
import { loadResource } from '../market/resource';
import type { MacroContextData, MacroReading, Resource } from '../market/types';

const dayMs = 86_400_000;
export const TREASURY_SOURCE =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve';
const point = z.object({ date: z.iso.date(), value: z.number().finite() });
const curveSchema = z.object({ two: point.nullable(), ten: point.nullable() });
type Curve = z.infer<typeof curveSchema>;

export function treasuryFeedUrl(year: number): string {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

/** Treasury CSV uses quoted tenor headers and MM/DD/YYYY dates; blanks are never zero. */
export function parseTreasuryCsv(
  csv: string,
  today = new Date().toISOString().slice(0, 10),
): Curve {
  const lines = csv.trim().split(/\r?\n/);
  const cells = (line: string) =>
    line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
  const header = cells(lines.shift()?.replace(/^\uFEFF/, '') ?? '');
  const dateCol = header.indexOf('Date'),
    twoCol = header.indexOf('2 Yr'),
    tenCol = header.indexOf('10 Yr');
  if ([dateCol, twoCol, tenCol].some((c) => c < 0))
    throw new Error('Invalid Treasury CSV columns');
  const curve: Curve = { two: null, ten: null };
  for (const line of lines) {
    const row = cells(line);
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(row[dateCol]);
    if (!match) continue;
    const date = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    if (!z.iso.date().safeParse(date).success || date > today) continue;
    for (const [key, col] of [
      ['two', twoCol],
      ['ten', tenCol],
    ] as const) {
      const raw = row[col];
      if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) continue;
      const value = Number(raw);
      if (Number.isFinite(value) && (!curve[key] || date > curve[key]!.date))
        curve[key] = { date, value };
    }
  }
  return curve;
}

function asReading(
  curve: Resource<Curve>,
  key: 'two' | 'ten',
): Resource<MacroReading> {
  const latest = curve.data?.[key];
  const observedAt = latest ? `${latest.date}T00:00:00.000Z` : null;
  const usable = latest && Date.now() - Date.parse(observedAt!) <= 7 * dayMs;
  const cap = (date: string | null) =>
    date && observedAt
      ? new Date(
          Math.min(Date.parse(date), Date.parse(observedAt) + 7 * dayMs),
        ).toISOString()
      : null;
  return {
    data: usable ? { value: latest.value, unit: 'percent' } : null,
    meta: {
      ...curve.meta,
      instrumentId: key === 'two' ? 'UST-PAR-2Y' : 'UST-PAR-10Y',
      observedAt,
      freshUntil: cap(curve.meta.freshUntil),
      staleUntil: cap(curve.meta.staleUntil),
      status: usable ? curve.meta.status : 'unavailable',
    },
  };
}

export function yieldSpread(
  two: Resource<MacroReading>,
  ten: Resource<MacroReading>,
): Resource<MacroReading> {
  const compatible =
    two.data &&
    ten.data &&
    two.meta.observedAt &&
    two.meta.observedAt === ten.meta.observedAt &&
    !['unavailable', 'empty'].includes(two.meta.status) &&
    !['unavailable', 'empty'].includes(ten.meta.status);
  const earliest = (key: 'fetchedAt' | 'freshUntil' | 'staleUntil') =>
    [two.meta[key], ten.meta[key]]
      .filter((d): d is string => d !== null)
      .sort()[0] ?? null;
  return {
    data: compatible
      ? {
          value: Math.round((ten.data!.value - two.data!.value) * 10000) / 100,
          unit: 'basis-points',
        }
      : null,
    meta: {
      provider: 'Calculated from U.S. Treasury',
      instrumentId: 'UST-PAR-10Y-2Y',
      sourceUrl: TREASURY_SOURCE,
      observedAt: compatible ? two.meta.observedAt : null,
      fetchedAt: earliest('fetchedAt'),
      freshUntil: earliest('freshUntil'),
      staleUntil: earliest('staleUntil'),
      delayed: true,
      status: compatible
        ? two.meta.status === 'stale' || ten.meta.status === 'stale'
          ? 'stale'
          : 'fresh'
        : 'unavailable',
    },
  };
}

function pendingReading(id: string): Resource<MacroReading> {
  return {
    data: null,
    meta: {
      provider: 'Pending source approval',
      instrumentId: id,
      sourceUrl: '',
      observedAt: null,
      fetchedAt: null,
      freshUntil: null,
      staleUntil: null,
      status: 'unavailable',
      delayed: true,
    },
  };
}

export async function fetchMacroContext(): Promise<MacroContextData> {
  const year = new Date().getUTCFullYear();
  const curve = await loadResource({
    key: `context:treasury:par:v1:${year}`,
    provider: 'U.S. Department of the Treasury',
    instrumentId: 'UST-PAR-CURVE',
    sourceUrl: TREASURY_SOURCE,
    ttlMs: 3_600_000,
    maxAgeMs: 7 * dayMs,
    delayed: true,
    schema: curveSchema,
    load: async () => {
      const response = await providerFetch(treasuryFeedUrl(year));
      const data = parseTreasuryCsv(await response.text());
      // At the start of January, the previous year's last observation may still be current.
      if ((!data.two || !data.ten) && new Date().getUTCMonth() === 0) {
        const prior = parseTreasuryCsv(
          await (await providerFetch(treasuryFeedUrl(year - 1))).text(),
        );
        data.two ??= prior.two;
        data.ten ??= prior.ten;
      }
      if (!data.two && !data.ten) throw new Error('No Treasury observations');
      return { data, observedAt: null };
    },
  });
  const treasury2y = asReading(curve, 'two'),
    treasury10y = asReading(curve, 'ten');
  // Unapproved DXY/VIX adapters are not called, even when old cache entries exist.
  return {
    treasury2y,
    treasury10y,
    spread: yieldSpread(treasury2y, treasury10y),
    dxy: pendingReading('DXY'),
    vix: pendingReading('VIX'),
  };
}
