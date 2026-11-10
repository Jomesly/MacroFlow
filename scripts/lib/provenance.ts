import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PriceDataset } from '../../src/lib/market-evidence';

export const PRICE_INSTRUMENTS = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD', 'DXY', 'US10Y'] as const;

/** What a price file contained when replay read it. bars=0 means the instrument was not usable. */
export interface PriceInput {
  instrument: string;
  provider: string | null;
  fetchedAt: string | null;
  bars: number;
  sha256: string | null;
}

/** Inputs frozen into replay.json and carried into evaluation.json, so the report never re-reads live files. */
export interface InputProvenance {
  schemaVersion: 1;
  prices: PriceInput[];
  availabilityFetchedAt: string | null;
  availability: Record<string, string>;
  fredSnapshots: number;
  fredFirstAvailableAt: string | null;
  fredLastAvailableAt: string | null;
  archivedEvents: number;
}

export const sha256 = (contents: string) => createHash('sha256').update(contents).digest('hex');

export function describePriceInput(instrument: string, contents: string | null): PriceInput {
  if (contents === null) return { instrument, provider: null, fetchedAt: null, bars: 0, sha256: null };
  const dataset = JSON.parse(contents) as Partial<PriceDataset>;
  return { instrument, provider: dataset.provider ?? null, fetchedAt: dataset.fetchedAt ?? null,
    bars: Array.isArray(dataset.bars) ? dataset.bars.length : 0, sha256: sha256(contents) };
}

export function readPriceFile(root: string, instrument: string): { dataset: PriceDataset | undefined; input: PriceInput } {
  const file = path.join(root, 'prices', `${instrument}.json`);
  const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  return { dataset: contents === null ? undefined : JSON.parse(contents), input: describePriceInput(instrument, contents) };
}

export function readAvailability(root: string): Pick<InputProvenance, 'availabilityFetchedAt' | 'availability'> {
  const file = path.join(root, 'prices', 'availability.json');
  if (!fs.existsSync(file)) return { availabilityFetchedAt: null, availability: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { availabilityFetchedAt: parsed.fetchedAt ?? null, availability: parsed.availability ?? {} };
}

/** Instruments whose current file no longer matches what replay recorded. */
export function changedPriceInputs(recorded: PriceInput[], current: PriceInput[]): string[] {
  return recorded.filter(entry => current.find(now => now.instrument === entry.instrument)?.sha256 !== entry.sha256)
    .map(entry => entry.instrument);
}

export function coverageLines(provenance: InputProvenance): string[] {
  return provenance.prices.map(input => input.bars > 0
    ? `- ${input.instrument}: ${input.bars} hourly bars from ${input.provider}, fetched ${input.fetchedAt}`
    : `- ${input.instrument}: excluded (${provenance.availability[input.instrument] ?? 'no price file at replay time'})`);
}

export function sourceStatement(provenance: InputProvenance): string {
  const used = provenance.prices.filter(input => input.bars > 0);
  const excluded = provenance.prices.filter(input => input.bars === 0).map(input => input.instrument);
  const parts = [
    excluded.length ? `Excluded at replay time: ${excluded.join(', ')}.` : 'No instrument was excluded at replay time.',
    used.length ? `Providers: ${used.map(input => `${input.instrument} ${input.provider}`).join('; ')}.` : '',
    used.some(input => ['US100', 'DJ30'].includes(input.instrument))
      ? 'US100/DJ30 are cash-index references, not broker CFD executions; partial closing bars are excluded.' : '',
  ];
  return parts.filter(Boolean).join(' ');
}
