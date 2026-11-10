import { test, expect } from '@playwright/test';
import { fixture, calendarFixture, macroFixture } from './fixtures/market';
import type { BiasApiResponse } from '../../src/lib/types';

let body: BiasApiResponse;
test.beforeEach(async ({page}) => {
  body = structuredClone(fixture);
  await page.route('**/api/bias*', route => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol');
    return route.fulfill({json: {...body, data: symbol ? body.data.filter(r => r.symbol === symbol) : body.data}});
  });
  await page.route('**/api/calendar/consensus', route => route.fulfill({json: {events: [], archiveStatus: 'ok'}}));
  await page.route('**/api/calendar', route => route.fulfill({json: calendarFixture}));
  await page.route('**/api/macro-context', route => route.fulfill({json: macroFixture}));
});

test('signed bias percentages and low conviction remain visible without calibration', async ({page}) => {
  body = {...body, data: body.data.map(r => ({...r, biasScore: -98, biasPercent: -98, probability: undefined, direction: 'bearish', conviction: 'low'}))};
  await page.goto('/');
  await expect(page.locator('.market-card')).toHaveCount(5);
  await expect(page.locator('.market-score').first()).toHaveText('-98%');
  await expect(page.locator('.market-card').first()).toContainText('Low conviction');
  await expect(page.locator('.market-grid')).not.toContainText('Probability unavailable');
  await page.goto('/markets/XAUUSD');
  await expect(page.locator('.research-bias strong')).toHaveText('-98%');
  await expect(page.getByRole('region', {name: 'Current market bias'})).toContainText('A strong bias can still have low conviction.');
});

test('both signs at the 50 threshold rank above weaker readings', async ({page}) => {
  body.data = body.data.map((r, i) => {
    const value = [-50, 49, 50, 0, -80][i];
    return {...r, biasScore: value, biasPercent: value, direction: value < 0 ? 'bearish' : value > 0 ? 'bullish' : 'neutral'};
  });
  await page.goto('/');
  await expect(page.locator('.market-card h3')).toHaveText(['BTCUSD', 'US100', 'XAUUSD', 'GBPUSD', 'DJ30']);
  await expect(page.locator('.market-score')).toHaveText(['-80%', '+50%', '-50%', '+49%', '0%']);
});

test('technical comparison preserves the bias and failed refresh retains a labeled previous read', async ({page}) => {
  await page.goto('/markets/BTCUSD');
  await expect(page.locator('.research-bias strong')).toHaveText('-55%');
  await page.getByLabel('Your technical direction').selectOption('short');
  await expect(page.getByRole('status').filter({hasText: 'matches the macro lean'})).toBeVisible();
  await page.getByLabel('Your technical direction').selectOption('long');
  await expect(page.getByRole('status').filter({hasText: 'opposes the macro lean'})).toBeVisible();
  await expect(page.locator('.research-bias strong')).toHaveText('-55%');
  await page.route('**/api/bias*', route => route.fulfill({status: 503, json: {error: 'Unavailable'}}));
  await page.getByRole('button', {name: 'Refresh analysis', exact: true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('last successful read');
  await expect(page.locator('.research-bias strong')).toHaveText('-55%');
  await expect(page.locator('.research-freshness')).toContainText('Outdated read.');
});
