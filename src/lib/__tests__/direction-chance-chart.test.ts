import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import DirectionChanceChart from '../../components/market/DirectionChanceChart';
import { estimateDirectionChance } from '../direction-chance';

it('renders both complementary directions and a matching proportional chart', () => {
  const chance = estimateDirectionChance({ momentum: { score: -50, weight: 1 }, news: null, macro: null }, 0, '2026-11-12T12:00:00.000Z');
  const html = renderToStaticMarkup(createElement(DirectionChanceChart, { chance }));
  expect(html).toContain('33.3% up, 66.7% down');
  expect(html).toContain('width:33.3%');
  expect(html).toContain('width:66.7%');
  expect(html).toContain('Uncalibrated model estimate');
  expect(html).not.toContain('/100');
});

it('renders missing evidence without inventing a percentage', () => {
  const html = renderToStaticMarkup(createElement(DirectionChanceChart, { chance: null, compact: true }));
  expect(html).toContain('Chance unavailable');
  expect(html).not.toContain('%');
});
