import { describe, expect, it } from 'vitest';
import cases from './fixtures/headlines-golden.json';
import { classifyHeadline } from '../api/classifier';

// Labels are a trader's reading of each headline, not the classifier's output.
// Never edit a label to match the code, and never lower the precision bar.
const key = (r: { category: string; value: string; symbol?: string }) => [r.category, r.value, r.symbol].filter(Boolean).join(':');
const channel = (k: string) => k.split(':').filter((_, i) => i !== 1).join(':');

describe('labelled headline set', () => {
  it('has enough labelled headlines to mean something', () => expect(cases.length).toBeGreaterThanOrEqual(60));

  it('never reads a labelled channel in the opposite direction', () => {
    const wrong = cases.flatMap(c => classifyHeadline(c.text).map(key)
      .filter(k => c.expect.some(e => channel(e) === channel(k) && e !== k)).map(k => `${c.text.slice(0, 80)} -> ${k}`));
    expect(wrong).toEqual([]);
  });

  it('keeps precision at or above 90%', () => {
    const predicted = cases.flatMap(c => classifyHeadline(c.text).map(key).map(k => ({ text: c.text.slice(0, 80), k, ok: c.expect.includes(k) })));
    const precision = predicted.filter(p => p.ok).length / predicted.length;
    expect({ precision: precision >= 0.9 ? 'ok' : precision.toFixed(3), falsePositives: precision >= 0.9 ? [] : predicted.filter(p => !p.ok) })
      .toEqual({ precision: 'ok', falsePositives: [] });
  });
});
