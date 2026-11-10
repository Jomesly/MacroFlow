import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

const statusPath = process.env.MACROFLOW_AUTH_TEST_STATUS;
if (!statusPath) throw new Error('Set MACROFLOW_AUTH_TEST_STATUS to the disposable local Supabase status file.');
const local = JSON.parse(readFileSync(statusPath, 'utf8').replace(/^﻿/, ''));
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(local.API_URL)) throw new Error('Dashboard tests only use isolated local Supabase.');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'MacroFlow-Dashboard-Test-2026!';
const artifacts = path.resolve('.artifacts/dashboard-review');

async function setup(page: Page) {
  page.setDefaultTimeout(25000);
  const email = `dashboard-${crypto.randomUUID()}@example.test`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(user.error).toBeNull();
  const userId = user.data.user!.id;
  expect((await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', userId)).error).toBeNull();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeEnabled();
  const response = await page.request.post('/api/journal/trading-accounts', { data: { brokerName: 'IC Markets', accountNumber: '000777', nickname: 'Dashboard', currency: 'USD' } });
  expect(response.status()).toBe(201);
  return { accountId: (await response.json()).account.id as string, userId };
}

/** Two months of fixed trades: results never depend on the day the test runs. */
function seedRows(userId: string, accountId: string) {
  const symbols = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
  const tags = ['Sweep', 'IFVG', 'Fib', 'Asian Range'];
  const hours = [1, 7, 13, 15, 18, 23];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = [];
  for (let day = 0; day < 44; day += 1) {
    const date = new Date(Date.UTC(2026, 8, 1 + day));
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    for (let n = 0; n < 1 + Math.floor(next() * 2); n += 1) {
      const opened = new Date(date.getTime() + hours[Math.floor(next() * hours.length)] * 3_600_000);
      const roll = next();
      const pnl = roll < 0.52 ? Math.round(40 + next() * 260) : roll < 0.6 ? 0 : -Math.round(30 + next() * 170);
      rows.push({
        user_id: userId,
        journal_account_id: accountId,
        symbol: symbols[Math.floor(next() * symbols.length)],
        direction: next() < 0.5 ? 'long' : 'short',
        entry_price: 100,
        exit_price: 101,
        result: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
        pnl_amount: pnl,
        logged_at: opened.toISOString(),
        closed_at: new Date(opened.getTime() + 45 * 60_000).toISOString(),
        setup_tags: [tags[Math.floor(next() * tags.length)]],
      });
    }
  }
  return rows;
}

async function audit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

test('analytics dashboard charts match the API, respond to filters and stay accessible on desktop and mobile', async ({ page }) => {
  const { accountId, userId } = await setup(page);
  const rows = seedRows(userId, accountId);
  expect((await admin.from('trades').insert(rows)).error).toBeNull();
  const api = (await (await page.request.get(`/api/journal/analytics?tradingAccount=${accountId}`)).json()).analytics;
  const net = rows.reduce((sum, row) => sum + row.pnl_amount, 0);
  expect(api.totals.net).toBe(net);
  expect(api.equity.at(-1).cumulative).toBe(net);
  expect(api.totals.maxDrawdown).toBeLessThanOrEqual(0);
  expect(api.timeHeatmap.reduce((sum: number, cell: { trades: number }) => sum + cell.trades, 0)).toBe(rows.length);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/journal?tradingAccount=${accountId}`);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('paragraph').filter({ hasText: /^Net P&L · USD$/ })).toBeVisible();
  await expect(panel.getByRole('img', { name: /^Cumulative net P&L across/ })).toBeVisible();
  await expect(panel.getByRole('img', { name: /^Net P&L for the last 30 trading days/ })).toBeVisible();
  await expect(panel.getByRole('table', { name: 'Daily results for October 2026' })).toBeVisible();
  await expect(panel.getByRole('table', { name: /^Win rate by entry weekday/ })).toBeVisible();
  for (const title of ['By symbol', 'By setup tag', 'By session', 'By weekday']) {
    await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }

  // The hover readout reports the day under the pointer.
  const curve = panel.getByRole('img', { name: /^Cumulative net P&L across/ });
  const box = (await curve.boundingBox())!;
  await curve.hover({ position: { x: box.width - 2, y: box.height / 2 } });
  await expect(curve.locator('.jd-tip')).toContainText('Total');
  await page.mouse.move(0, 0);

  await panel.getByRole('button', { name: 'Previous month', exact: true }).click();
  const september = panel.getByRole('table', { name: 'Daily results for September 2026' });
  await expect(september).toBeVisible();
  const firstDay = api.calendar[0];
  await expect(september.locator('td[title^="Sep 1, 2026"]')).toContainText(`${firstDay.trades} ${firstDay.trades === 1 ? 'trade' : 'trades'}`);

  await page.waitForTimeout(1200); // let the entrance animations settle before measuring
  await audit(page);
  mkdirSync(artifacts, { recursive: true });
  await panel.screenshot({ path: path.join(artifacts, 'dashboard-desktop.png') });

  // Filtering to one symbol narrows every figure to that symbol.
  const gold = rows.filter(row => row.symbol === 'XAUUSD');
  await page.locator('#flt-symbol').selectOption('XAUUSD');
  await expect(panel.getByRole('table', { name: 'Breakdown by symbol' }).getByRole('row')).toHaveCount(2);
  await expect(panel.locator('.jd-strip')).toContainText(`${gold.length} · ${gold.length} closed`);
  await page.locator('#flt-symbol').selectOption('');

  // An empty range clears the charts but keeps the headline tiles.
  await panel.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(panel.getByText('No trades in this view yet.')).toBeVisible();
  await expect(panel.getByRole('paragraph').filter({ hasText: /^Net P&L$/ })).toBeVisible();
  await panel.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(panel.getByRole('img', { name: /^Cumulative net P&L across/ })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1200);
  await audit(page);
  await panel.screenshot({ path: path.join(artifacts, 'dashboard-mobile.png') });
});
