import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

const statusPath = process.env.MACROFLOW_AUTH_TEST_STATUS;
if (!statusPath) throw new Error('Set MACROFLOW_AUTH_TEST_STATUS to the disposable local Supabase status file.');
const local = JSON.parse(readFileSync(statusPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, string>;
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(local.API_URL)) throw new Error('Funds tests only run on isolated local Supabase.');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'MacroFlow-Funds-Test-2026!';
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
const localTime = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const artifacts = path.resolve('.artifacts/funds-review');
test.beforeEach(({ page }) => { page.setDefaultTimeout(25_000); });

async function setup(page: Page) {
  const email = `funds-${crypto.randomUUID()}@example.test`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(user.error).toBeNull();
  const userId = user.data.user!.id;
  expect((await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', userId)).error).toBeNull();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeEnabled();
  const create = async (nickname: string, accountNumber: string, currency = 'USD') => {
    const response = await page.request.post('/api/journal/trading-accounts', { data: { brokerName: 'IC Markets', accountNumber, nickname, currency } });
    expect(response.status()).toBe(201);
    return (await response.json()).account.id as string;
  };
  const personal = await create('Personal', '00123456');
  const funded = await create('Funded challenge', '00987654');
  await page.goto(`/journal?tradingAccount=${personal}`);
  await expect(page.getByRole('heading', { name: 'Capture the trade' })).toBeVisible();
  return { personal, funded, userId, create };
}

async function funds(page: Page, id: string) {
  const response = await page.request.get(`/api/journal/trading-accounts/${id}/funds`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function mutate(page: Page, id: string, mutation: object, requestId = crypto.randomUUID()) {
  return page.request.post(`/api/journal/trading-accounts/${id}/funds`, { data: { requestId, mutation } });
}

async function audit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
}

test('multiple account checkboxes, independent results, account funds and audited corrections work on desktop and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { personal, funded } = await setup(page);
  mkdirSync(artifacts, { recursive: true });
  await page.getByRole('button', { name: 'Manage funds', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Account funds', exact: true });
  await dialog.getByLabel('Opening balance · USD', { exact: true }).fill('1000');
  await dialog.getByLabel('Balance as of').fill(localTime(ago(24 * 30)));
  await dialog.getByRole('button', { name: 'Save opening balance', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Opening balance saved');
  await dialog.getByRole('button', { name: 'Add funds entry', exact: true }).click();
  await dialog.getByLabel('Amount · USD', { exact: true }).fill('500');
  await dialog.getByLabel('Effective date & time').fill(localTime(ago(24)));
  await dialog.getByLabel('Note (optional)').fill('Initial deposit');
  await expect(dialog.locator('.funds-balance-preview')).toContainText('1,500.00 USD');
  await dialog.getByRole('button', { name: 'Record funds entry', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Deposit recorded');
  await audit(page);
  await page.screenshot({ path: path.join(artifacts, 'funds-desktop.png'), animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  await dialog.getByRole('button', { name: 'Close funds dialog' }).click();
  expect((await mutate(page, funded, { action: 'set-opening', amount: '2000', effectiveAt: ago(24 * 30).toISOString(), expectedVersion: 0 })).ok()).toBe(true);

  const form = page.locator('.journal-form-panel:visible');
  await expect(form.getByText('Log to accounts', { exact: true })).toHaveCount(0);
  const picker = page.getByRole('button', { name: 'Trading account', exact: true });
  await picker.click();
  const options = page.getByRole('group', { name: 'Trading accounts', exact: true });
  await options.getByRole('checkbox', { name: /Funded challenge/ }).check();
  await expect(picker).toContainText('2 selected');
  await expect(options).toHaveCSS('position', 'absolute');
  await form.getByLabel('Notes', { exact: true }).fill('Draft survives account selection');
  await expect(options).toHaveCount(0);
  await picker.click();
  await options.getByRole('checkbox', { name: /Funded challenge/ }).uncheck();
  await options.getByRole('checkbox', { name: /Funded challenge/ }).check();
  await expect(form.getByLabel('Notes', { exact: true })).toHaveValue('Draft survives account selection');
  await audit(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await audit(page);
  await page.screenshot({ path: path.join(artifacts, 'account-dropdown-mobile.png'), animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
  await expect(picker).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect(form.locator('.capture-logged-at')).toBeVisible();
  await expect(form.locator('.capture-execution')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Log Trade', exact: true })).toBeDisabled();
  await form.getByLabel('Symbol', { exact: true }).selectOption('XAUUSD');
  await form.getByRole('button', { name: 'Long', exact: true }).click();
  await form.getByLabel('Entry price', { exact: true }).fill('2000');
  await expect(form.getByRole('button', { name: 'Log Trade', exact: true })).toBeEnabled();
  await form.getByLabel('Exit Price (optional)', { exact: true }).fill('2020');
  await expect(form.getByRole('button', { name: 'Log Trade', exact: true })).toBeDisabled();
  await expect(form.getByRole('status', { name: 'P&L (preview)', exact: true })).toHaveText('+1.00%');
  await form.getByRole('button', { name: 'Short', exact: true }).click();
  await expect(form.getByRole('status', { name: 'P&L (preview)', exact: true })).toHaveText('-1.00%');
  await form.getByRole('button', { name: 'Loss', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Log Trade', exact: true })).toBeDisabled();
  await form.getByLabel('Amount (USD)', { exact: true }).fill('80');
  await expect(form.getByRole('button', { name: 'Log Trade', exact: true })).toBeEnabled();
  await expect(form.locator('.capture-price-grid')).toHaveCSS('grid-template-columns', /\S+ \S+ \S+/);
  await form.screenshot({ path: path.join(artifacts, 'classic-capture-desktop.png'), animations: 'disabled' });
  await form.getByRole('button', { name: 'Long', exact: true }).click();
  await form.getByRole('button', { name: 'Win', exact: true }).click();
  await form.getByLabel('Notes', { exact: true }).fill('Shared decision, separate executions');
  await audit(page);
  await page.screenshot({ path: path.join(artifacts, 'multi-account-desktop.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  await page.setViewportSize({ width: 375, height: 900 });
  await audit(page);
  await page.screenshot({ path: path.join(artifacts, 'multi-account-mobile.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  await form.getByRole('button', { name: 'Log Trade', exact: true }).click();
  await expect(form.locator('.capture-success')).toContainText('Saved to Personal and Funded challenge');
  await expect(form.getByLabel('Exit Price (optional)', { exact: true })).toHaveValue('');
  await expect(form.getByRole('button', { name: 'Win', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await picker.click();
  await expect(options.getByRole('checkbox', { name: /Funded challenge/ })).toBeChecked();
  await options.getByRole('checkbox', { name: /Funded challenge/ }).uncheck();
  await options.getByRole('checkbox', { name: /Personal/ }).uncheck();
  await page.keyboard.press('Escape');
  await expect(form.getByRole('button', { name: 'Log Trade', exact: true })).toBeDisabled();
  const all = await (await page.request.get('/api/journal/trade')).json();
  expect(all.trades).toHaveLength(2);
  expect(new Set(all.trades.map((trade: { tradeGroupId: string }) => trade.tradeGroupId)).size).toBe(1);
  expect(all.trades.every((trade: { exitPrice: number; result: string; pnlPercent: number; pnlAmount: number | null }) => trade.exitPrice === 2020 && trade.result === 'win' && trade.pnlPercent === 1 && trade.pnlAmount === 80)).toBe(true);
  expect((await funds(page, personal)).summary).toMatchObject({ balance: '1580', missingPnl: 0, complete: true });
  expect((await funds(page, funded)).summary).toMatchObject({ balance: '2080', missingPnl: 0, complete: true });
  // Adjusting one account's cash outcome leaves its sibling unchanged.
  const fundedTrade = all.trades.find((trade: { journalAccountId: string }) => trade.journalAccountId === funded);
  const correction = await page.request.put(`/api/journal/trade/${fundedTrade.id}`, { data: { expectedRevision: fundedTrade.revision, netPnl: '250' } });
  expect(correction.status()).toBe(200);
  expect((await funds(page, personal)).summary.balance).toBe('1580');
  expect((await funds(page, funded)).summary.balance).toBe('2250');

  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByLabel('Trading account', { exact: true }).selectOption('');
  await expect(page.locator('.trade-history-count')).toContainText('2 account trades · 1 trading decision');
  const trade = all.trades.find((trade: { journalAccountId: string }) => trade.journalAccountId === personal);
  await page.locator('.trade-record').filter({ hasText: 'Personal' }).locator('.trade-history-row').click();
  const details = page.locator(`#trade-details-${trade.id}`);
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await details.getByLabel(/^Net P&L/).fill('120');
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(details.locator('.trade-cash-result')).toContainText('120.00 USD');
  expect((await funds(page, personal)).summary.balance).toBe('1620');
  expect((await funds(page, funded)).summary.balance).toBe('2250');
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await details.getByRole('checkbox', { name: 'Keep this trade open / reopen it' }).check();
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Close Trade', exact: true })).toBeVisible();
  expect((await funds(page, personal)).summary.balance).toBe('1500');
  expect((await funds(page, funded)).summary.balance).toBe('2250');

  await page.getByLabel('Trading account', { exact: true }).selectOption(personal);
  await page.getByRole('button', { name: 'Manage funds', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Edit Deposit 500.00 USD', exact: true }).click();
  await dialog.getByLabel('Amount · USD', { exact: true }).fill('600');
  await dialog.getByLabel('Correction reason', { exact: true }).fill('Corrected statement amount');
  await dialog.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Correction saved');
  await dialog.getByRole('button', { name: 'Void', exact: true }).click();
  await expect(dialog.locator('.funds-balance-preview')).toContainText('1,000.00 USD');
  await dialog.getByLabel('Correction reason', { exact: true }).fill('Duplicate statement line');
  await dialog.getByRole('button', { name: 'Void entry', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Entry voided');
  await expect(dialog.getByText('Voided', { exact: true }).first()).toBeVisible();
  await dialog.locator('.funds-history-entry').getByText('Change history · 3', { exact: true }).click();
  await expect(dialog.getByText('Before: 500.00 USD', { exact: false })).toBeVisible();
  expect((await funds(page, personal)).summary.balance).toBe('1000');
  await audit(page);
  await page.screenshot({ path: path.join(artifacts, 'funds-mobile-history.png'), animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('result buttons apply positive cash amounts with the correct sign and currency precision', async ({ page }) => {
  const { personal, create } = await setup(page);
  expect((await mutate(page, personal, { action: 'set-opening', amount: '1000', effectiveAt: ago(24).toISOString(), expectedVersion: 0 })).ok()).toBe(true);
  const form = page.locator('.journal-form-panel:visible');
  const save = form.getByRole('button', { name: 'Log Trade', exact: true });
  const setupTrade = async () => {
    await form.getByLabel('Symbol', { exact: true }).selectOption('XAUUSD');
    await form.getByRole('button', { name: 'Long', exact: true }).click();
    await form.getByLabel('Entry price', { exact: true }).fill('2000');
  };
  for (const outcome of [
    { name: 'Loss', amount: '75.50', net: '-75.5', balance: '924.5', result: 'loss' },
    { name: 'Win', amount: '12.25', net: '12.25', balance: '936.75', result: 'win' },
    { name: 'Breakeven', amount: '', net: '0', balance: '936.75', result: 'breakeven' },
  ]) {
    await setupTrade();
    await form.getByRole('button', { name: outcome.name, exact: true }).click();
    if (outcome.amount) {
      const amount = form.getByLabel('Amount (USD)', { exact: true });
      await expect(save).toBeDisabled();
      for (const invalid of ['-50', '0', '1.001', 'abc']) {
        await amount.fill(invalid);
        await expect(save).toBeDisabled();
      }
      await amount.fill(outcome.amount);
    } else {
      await expect(form.getByLabel('Amount (USD)', { exact: true })).toHaveCount(0);
    }
    await expect(save).toBeEnabled();
    await save.click();
    await expect(form.locator('.capture-success')).toContainText('Saved to Personal');
    const trades = (await (await page.request.get('/api/journal/trade')).json()).trades;
    expect(trades[0]).toMatchObject({ result: outcome.result, pnlAmountExact: outcome.net });
    expect((await funds(page, personal)).summary.balance).toBe(outcome.balance);
  }

  // Mixed currencies stay explicit: a dollar amount is never treated as BTC.
  const cryptoAccount = await create('Crypto', 'cash-btc', 'BTC');
  expect((await mutate(page, cryptoAccount, { action: 'set-opening', amount: '0.1', effectiveAt: ago(24).toISOString(), expectedVersion: 0 })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Trading account', exact: true }).click();
  await page.getByRole('group', { name: 'Trading accounts', exact: true }).getByRole('checkbox', { name: /Crypto/ }).check();
  await page.keyboard.press('Escape');
  await setupTrade();
  await form.getByRole('button', { name: 'Win', exact: true }).click();
  await form.getByLabel('Amount (USD)', { exact: true }).fill('20');
  await expect(save).toBeDisabled();
  await form.getByLabel('Amount (BTC)', { exact: true }).fill('0.00000001');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form.locator('.capture-success')).toContainText('Saved to');
  expect((await funds(page, personal)).summary.balance).toBe('956.75');
  expect((await funds(page, cryptoAccount)).summary.balance).toBe('0.10000001');
  const cryptoAnalytics = await (await page.request.get(`/api/journal/analytics?tradingAccount=${cryptoAccount}`)).json();
  expect(cryptoAnalytics.currency).toBe('BTC');
  expect(cryptoAnalytics.analytics.totals.net).toBe(0.00000001);
  expect(cryptoAnalytics.analytics.equity.at(-1).cumulative).toBe(0.00000001);
});

test('multi-account and funds APIs prevent duplicate concurrent saves, cross-owner writes and MT5 copies, and preserve exact money', async ({ page }) => {
  const { personal, funded, userId, create } = await setup(page);
  const payload = { requestId: crypto.randomUUID(), symbol: 'XAUUSD', direction: 'long', entryPrice: 2000, openedAt: ago(2).toISOString(), accounts: [{ accountId: personal }, { accountId: funded }] };
  const responses = await Promise.all(Array.from({ length: 3 }, () => page.request.post('/api/journal/trade-batches', { data: payload })));
  expect(responses.map(response => response.status())).toEqual([201, 201, 201]);
  const results = await Promise.all(responses.map(response => response.json()));
  expect(new Set(results.map(result => result.groupId)).size).toBe(1);
  expect((await (await page.request.get('/api/journal/trade')).json()).trades).toHaveLength(2);
  expect((await page.request.post('/api/journal/trade-batches', { data: { ...payload, notes: 'different' } })).status()).toBe(409);
  expect((await page.request.post('/api/journal/trade-batches', { data: { ...payload, requestId: crypto.randomUUID(), accounts: [] } })).status()).toBe(400);

  const foreign = await admin.auth.admin.createUser({ email: `foreign-${crypto.randomUUID()}@example.test`, password, email_confirm: true });
  const other = await admin.from('journal_accounts').insert({ user_id: foreign.data.user!.id, broker_name: 'Foreign', account_number: '00001', currency: 'USD' }).select('id').single();
  expect(other.error).toBeNull();
  expect((await page.request.get(`/api/journal/trading-accounts/${other.data!.id}/funds`)).status()).toBe(404);
  expect((await mutate(page, other.data!.id, { action: 'set-opening', amount: '0', effectiveAt: ago(24).toISOString(), expectedVersion: 0 })).status()).toBe(404);
  expect((await page.request.post('/api/journal/trade-batches', { data: { ...payload, requestId: crypto.randomUUID(), accounts: [{ accountId: personal }, { accountId: other.data!.id }] } })).status()).toBe(404);
  expect((await (await page.request.get('/api/journal/trade')).json()).trades).toHaveLength(2);

  const broker = await admin.from('broker_accounts').insert({ user_id: userId, account_login: '00009999', server: 'Funds-Test-Live', currency: 'USD' }).select('id').single();
  expect(broker.error).toBeNull();
  const linked = await admin.from('journal_accounts').select('id').eq('broker_account_id', broker.data!.id).single();
  expect((await page.request.post('/api/journal/trade-batches', { data: { ...payload, requestId: crypto.randomUUID(), accounts: [{ accountId: linked.data!.id }] } })).status()).toBe(400);
  await page.reload();
  await page.getByRole('button', { name: 'Trading account', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Trading accounts', exact: true }).getByRole('checkbox', { name: /00009999/ })).toBeDisabled();
  await page.keyboard.press('Escape');

  const cryptoAccount = await create('Crypto', 'crypto-0001', 'BTC');
  expect((await mutate(page, cryptoAccount, { action: 'set-opening', amount: '0.10000001', effectiveAt: ago(24).toISOString(), expectedVersion: 0 })).status()).toBe(200);
  const mutation = { action: 'add', kind: 'deposit', amount: '0.00000002', effectiveAt: ago(12).toISOString() };
  const request = crypto.randomUUID();
  const moneyResponses = await Promise.all([mutate(page, cryptoAccount, mutation, request), mutate(page, cryptoAccount, mutation, request)]);
  expect(moneyResponses.map(response => response.status())).toEqual([200, 200]);
  expect((await funds(page, cryptoAccount)).summary.balance).toBe('0.10000003');
  expect((await funds(page, cryptoAccount)).entries).toHaveLength(1);
  const cash = (await funds(page, cryptoAccount)).entries[0];
  expect((await mutate(page, cryptoAccount, { action: 'edit', entryId: cash.id, expectedVersion: 99, kind: 'deposit', amount: '1', effectiveAt: ago(12).toISOString(), reason: 'stale' })).status()).toBe(409);

  expect((await mutate(page, personal, { action: 'set-opening', amount: '1000', effectiveAt: ago(24).toISOString(), expectedVersion: 0 })).status()).toBe(200);
  const unknownTrade = { ...payload, requestId: crypto.randomUUID(), accounts: [{ accountId: personal, result: 'win', closedAt: ago(1).toISOString(), netPnl: null }] };
  expect((await page.request.post('/api/journal/trade-batches', { data: unknownTrade })).status()).toBe(201);
  expect((await funds(page, personal)).summary).toMatchObject({ balance: '1000', missingPnl: 1, complete: false });
});
