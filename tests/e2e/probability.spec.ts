import { test, expect } from '@playwright/test';
import { fixture, calendarFixture, macroFixture } from './fixtures/market';
import type { BiasApiResponse } from '../../src/lib/types';

let body: BiasApiResponse;
test.beforeEach(async ({page}) => {
  body=structuredClone(fixture);
  await page.route('**/api/bias*', route => {
    const symbol=new URL(route.request().url()).searchParams.get('symbol');
    return route.fulfill({json:{...body,data:symbol?body.data.filter(r=>r.symbol===symbol):body.data}});
  });
  await page.route('**/api/calendar/consensus', route=>route.fulfill({json:{events:[],archiveStatus:'ok'}}));
  await page.route('**/api/calendar', route=>route.fulfill({json:calendarFixture}));
  await page.route('**/api/macro-context', route=>route.fulfill({json:macroFixture}));
});

test('large legacy scores never masquerade as probabilities',async({page})=>{
  body={...body,data:body.data.map(r=>({...r,biasScore:-98,biasPercent:-98,probability:undefined,direction:'bearish'}))};
  await page.goto('/');
  await expect(page.locator('.market-card')).toHaveCount(5);
  await expect(page.locator('.market-score').first()).toHaveText('—');
  await expect(page.locator('.market-card').first()).toContainText('Probability unavailable');
  await expect(page.locator('.market-grid')).not.toContainText('98%');
  await page.goto('/markets/XAUUSD');
  await expect(page.getByRole('region',{name:'Current market bias'})).toContainText('Probability unavailable');
  await expect(page.locator('.research-bias strong')).toHaveText('—');
});

test('probabilities are unsigned and technical direction comparison does not change them',async({page})=>{
  await page.goto('/markets/BTCUSD');
  await expect(page.locator('.research-bias strong')).toHaveText('68.0%');
  await page.getByLabel('Your technical direction').selectOption('short');
  await expect(page.getByRole('status').filter({hasText:'matches the macro lean'})).toBeVisible();
  await page.getByLabel('Your technical direction').selectOption('long');
  await expect(page.getByRole('status').filter({hasText:'opposes the macro lean'})).toBeVisible();
  await expect(page.locator('.research-bias strong')).toHaveText('68.0%');
});

test('failed refresh and expired forecasts hide percentages while retaining macro context',async({page})=>{
  await page.clock.install();
  body.data=body.data.map(r=>({...r,probability:r.probability?{...r.probability,validUntil:new Date(Date.now()+30_000).toISOString()}:undefined}));
  await page.goto('/');
  await expect(page.locator('.market-score').first()).toHaveText('74.0%');
  await page.clock.fastForward(31_000);
  await expect(page.locator('.market-score').first()).toHaveText('—');
  await page.goto('/markets/XAUUSD');
  body.data=body.data.map(r=>({...r,probability:r.probability?{...r.probability,validUntil:new Date(Date.now()+86_400_000).toISOString()}:undefined}));
  await page.getByRole('button',{name:'Refresh analysis',exact:true}).click();
  await expect(page.locator('.research-bias strong')).toHaveText('62.0%');
  await page.route('**/api/bias*', route=>route.fulfill({status:503,json:{error:'Unavailable'}}));
  await page.getByRole('button',{name:'Refresh analysis',exact:true}).click();
  await expect(page.locator('.research-bias strong')).toHaveText('—');
  await expect(page.getByRole('heading',{name:'XAUUSD',exact:true})).toBeVisible();
});
