import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Deliberately no .env.local fallback: these tests must never mutate a hosted project.
const statusFile = process.env.MACROFLOW_AUTH_TEST_STATUS;
if (!statusFile) throw new Error('Run scripts/test-auth-local.ps1, or set MACROFLOW_AUTH_TEST_STATUS to isolated local Supabase status JSON.');
const local = JSON.parse(readFileSync(statusFile, 'utf8').replace(/^\uFEFF/, '')) as Record<string, string>;
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(local.API_URL)) throw new Error('Auth tests require the disposable local Supabase on port 55321.');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'MacroFlow-Test-2026!';
const uniqueEmail = () => 'journal-' + crypto.randomUUID() + '@example.test';

// Run these widget lifecycle checks with test-auth-local.ps1 -WithTurnstile
// -TestPattern Turnstile. The browser API is stubbed; no external challenges or
// hosted Auth credentials are used. Supabase token forwarding is unit-tested.
test.describe('Turnstile', () => {
  test.skip(!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, 'Use the isolated runner with -WithTurnstile.');

  test('gates submission, expires tokens, refreshes after failed login and remounts on navigation', async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.__captchaCount = 0;
        window.turnstile = {
          render(container, options) {
            window.__captchaCount += 1;
            window.__captchaOptions = options;
            container.textContent = 'Security check fixture';
            return String(window.__captchaCount);
          },
          remove() {}
        };
      `,
    }));
    const solve = () => page.evaluate(() => {
      const fixture = window as unknown as { __captchaOptions: { callback: (token: string) => void } };
      fixture.__captchaOptions.callback('test-token');
    });
    const renderCount = () => page.evaluate(() => (window as unknown as { __captchaCount: number }).__captchaCount);
    await page.goto('/login');
    await expect(page.getByText('Security check fixture')).toBeVisible();
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
    await expect(signIn).toBeDisabled();
    await solve();
    await expect(signIn).toBeEnabled();
    await page.evaluate(() => {
      const fixture = window as unknown as { __captchaOptions: { 'expired-callback': () => void } };
      fixture.__captchaOptions['expired-callback']();
    });
    await expect(signIn).toBeDisabled();
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue('');
    await solve();
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail());
    await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
    await signIn.click();
    await expect(page.locator('form').getByRole('alert')).toContainText('Sign-in failed');
    await expect.poll(renderCount).toBe(2);
    await expect(signIn).toBeDisabled();
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue('');
    await solve();
    // React resets form fields after a completed action, including errors.
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail());
    await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
    await signIn.click();
    await expect.poll(renderCount).toBe(3);
    await expect(signIn).toBeDisabled();

    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByText('Security check fixture')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled();
    await solve();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });

  test('keeps auth forms blocked and explains a script loading failure', async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.abort());
    await page.goto('/signup');
    await expect(page.locator('form').getByRole('alert')).toContainText('security check could not load');
    await expect(page.getByRole('button', { name: 'Create free account' })).toBeDisabled();
  });
});

async function signup(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create free account' }).click();
  await expect(page).toHaveURL(/\/check-email$/);
}

async function login(page: Page, email: string, secret = password) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function provisionManualAccount(page: Page) {
  const response = await page.request.post('/api/journal/trading-accounts', { data: { brokerName: 'Test Broker', accountNumber: '00123456', nickname: 'Manual journal', currency: 'USD' } });
  expect(response.status()).toBe(201);
  await page.reload();
}

async function emailLink(request: APIRequestContext, email: string, recovery = false, standard = false) {
  let link = '';
  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:55324/api/v1/messages');
    const inbox = await response.json() as { messages: { ID: string; To: { Address: string }[]; Subject: string }[] };
    const message = inbox.messages.find((entry) => entry.To.some((to) => to.Address === email) && (recovery ? /reset/i.test(entry.Subject) : /confirm/i.test(entry.Subject)));
    if (!message) return false;
    const detail = await (await request.get('http://127.0.0.1:55324/api/v1/message/' + message.ID)).json();
    const pattern = standard
      ? /http:\/\/(?:127\.0\.0\.1|localhost):55321\/auth\/v1\/verify\?[^"\s<>]+/
      : /http:\/\/localhost:3137\/auth\/confirm\?[^"\s<>]+/;
    link = String(detail.HTML ?? detail.Text).match(pattern)?.[0]?.replaceAll('&amp;', '&') ?? '';
    return !!link;
  }).toBe(true);
  return link;
}

async function ownerId(email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const owner = data.users.find((user) => user.email === email);
  if (!owner) throw new Error('Test user not found in the isolated Auth project.');
  return owner.id;
}

test('broker accounts support IDs, nicknames, separate drafts, and owned reports', async ({ page }) => {
  const email = uniqueEmail();
  const owner = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(owner.error).toBeNull();
  await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', owner.data.user!.id);
  await login(page, email);
  await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add trading account' });
  await dialog.getByLabel('Broker or firm', { exact: true }).selectOption('__custom');
  await dialog.getByLabel('Broker or firm name').fill('Test Broker');
  await dialog.getByLabel('Account number / ID').fill('00abc62');
  await dialog.getByLabel(/^Nickname/).fill('Funded account');
  const artifacts = path.resolve('.artifacts/ui-review');
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'add-account-desktop.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations.map(v => v.id)).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, 'add-account-mobile.png') });
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const picker = page.getByLabel('Trading account', { exact: true });
  await expect(picker).toContainText('Funded account · Test Broker · 00abc62');
  const firstId = new URL(page.url()).searchParams.get('tradingAccount')!;
  const tradeForm = page.locator('.journal-form-panel:visible');
  await tradeForm.getByLabel('Notes', { exact: true }).fill('Draft for funded account only');

  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await dialog.getByLabel('Broker or firm', { exact: true }).selectOption('Test Broker');
  await dialog.getByLabel('Account number / ID').fill('000002');
  await dialog.getByLabel(/^Nickname/).fill('Practice');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const secondId = new URL(page.url()).searchParams.get('tradingAccount')!;
  await expect(tradeForm.getByLabel('Notes', { exact: true })).toHaveValue('');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await picker.selectOption(firstId);
  await page.getByRole('tab', { name: 'Log Trade', exact: true }).click();
  await expect(tradeForm.getByLabel('Notes', { exact: true })).toHaveValue('Draft for funded account only');
  await tradeForm.getByLabel('Symbol', { exact: true }).selectOption('XAUUSD');
  await page.getByRole('button', { name: 'Long', exact: true }).click();
  await tradeForm.getByLabel('Entry price', { exact: true }).fill('2700');
  await page.getByRole('button', { name: 'Log Trade', exact: true }).click();
  await expect(page.getByText(/^Saved to/)).toBeVisible();
  const firstTrades = await (await page.request.get(`/api/journal/trade?tradingAccount=${firstId}`)).json();
  expect(firstTrades.trades).toHaveLength(1);
  expect(firstTrades.trades[0].journalAccountId).toBe(firstId);
  expect((await (await page.request.get(`/api/journal/trade?tradingAccount=${secondId}`)).json()).trades).toHaveLength(0);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: 'XAUUSD' })).toBeVisible();
  await picker.selectOption(secondId);
  await expect(page.getByRole('button').filter({ hasText: 'XAUUSD' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit account nickname' }).click();
  const rename = page.getByRole('dialog', { name: 'Edit nickname' });
  await rename.getByLabel(/^Nickname/).fill('Weekend practice');
  await rename.getByRole('button', { name: 'Save nickname' }).click();
  await expect(picker.locator('option:checked')).toContainText('Weekend practice · Test Broker · 000002');
  await page.reload();
  await expect(picker).toContainText('Weekend practice · Test Broker · 000002');
  expect(new URL(page.url()).searchParams.get('tradingAccount')).toBe(secondId);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await dialog.getByLabel('Broker or firm', { exact: true }).selectOption('Test Broker');
  await dialog.getByLabel('Account number / ID').fill('000002');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeFocused();

  const practiceTrade = await (await page.request.post('/api/journal/trade', { data: { journalAccountId: secondId, symbol: 'GBPUSD', direction: 'long', entryPrice: 100, exitPrice: 90, result: 'loss' } })).json();
  expect((await admin.from('trades').update({ pnl_amount: -25 }).eq('id', practiceTrade.trade.id)).error).toBeNull();
  expect((await admin.from('trades').update({ result: 'win', exit_price: 2727, pnl_amount: 100 }).eq('id', firstTrades.trades[0].id)).error).toBeNull();
  const firstAnalytics = await (await page.request.get(`/api/journal/analytics?tradingAccount=${firstId}`)).json();
  const secondAnalytics = await (await page.request.get(`/api/journal/analytics?tradingAccount=${secondId}`)).json();
  expect(firstAnalytics.analytics.totals.net).toBe(100);
  expect(secondAnalytics.analytics.totals.net).toBe(-25);
  const combined = await (await page.request.get('/api/journal/analytics')).json();
  expect(combined.moneyComparable).toBe(false);
  expect(combined.analytics.totals.net).toBeNull();
  const review = await (await page.request.get(`/api/journal/review?tradingAccount=${firstId}`)).json();
  expect(review.review.trades).toHaveLength(1);
  expect(review.review.analytics.totals.net).toBe(100);

  const foreignUser = await admin.auth.admin.createUser({ email: uniqueEmail(), password, email_confirm: true });
  const foreign = await admin.from('journal_accounts').insert({ user_id: foreignUser.data.user!.id, broker_name: 'Other broker', account_number: '1234', currency: 'USD' }).select('id').single();
  expect(foreign.error).toBeNull();
  const foreignId = foreign.data!.id;
  for (const endpoint of ['trade', 'analytics', 'review']) {
    expect((await page.request.get(`/api/journal/${endpoint}?tradingAccount=${foreignId}`)).status()).toBe(404);
  }
  expect((await page.request.post('/api/journal/trade', { data: { journalAccountId: foreignId, symbol: 'XAUUSD', direction: 'long', entryPrice: 100 } })).status()).toBe(404);
  expect((await page.request.patch(`/api/journal/trading-accounts/${foreignId}`, { data: { nickname: 'Stolen' } })).status()).toBe(404);
  expect((await page.request.get('/api/journal/trade?tradingAccount=invalid')).status()).toBe(400);
  const accounts = await (await page.request.get('/api/journal/trading-accounts')).json();
  expect(accounts.accounts.map((a: { id: string }) => a.id)).not.toContain(foreignId);
  const apiKey = await (await page.request.post('/api/journal/keys')).json();
  const sync = await page.request.post('/api/journal/ingest', { headers: { authorization: 'Bearer ' + apiKey.key }, data: { ea_version: 'accounts-test', account_login: '00009999', server: 'Local-Broker', currency: 'USD', trades: [] } });
  expect(sync.status()).toBe(200);
  const linked = (await (await page.request.get('/api/journal/trading-accounts')).json()).accounts.find((a: { accountNumber: string }) => a.accountNumber === '00009999');
  expect(linked.brokerAccountId).toBeTruthy();
});

test('verified signup isolates journals and enforces beta access for APIs and MT5', async ({ page, browser, request }) => {
  const emailA = uniqueEmail();
  await signup(page, emailA);
  expect((await page.request.get('/api/journal/trade')).status()).toBe(401);
  const contextA = await browser.newContext({ baseURL: 'http://localhost:3137' });
  const a = await contextA.newPage();
  // Email opened in another browser: no PKCE verifier from the signup browser.
  const confirmation = await emailLink(request, emailA);
  await a.goto(confirmation);
  await expect(a.getByRole('heading', { name: 'Welcome to your journal' })).toBeVisible();
  await a.getByLabel('Display name (optional)').fill('Trader A');
  await a.getByRole('button', { name: 'Log my first trade' }).click();
  await expect(a).toHaveURL(/\/journal\?tab=log$/);
  await provisionManualAccount(a);
  await a.getByLabel('Symbol', { exact: true }).selectOption('XAUUSD');
  await a.getByRole('button', { name: 'Long', exact: true }).click();
  await a.getByLabel('Entry price', { exact: true }).fill('2700');
  await a.getByRole('button', { name: 'Log Trade', exact: true }).last().click();
  await expect(a.getByText(/^Saved to/)).toBeVisible();
  const ownTrades = await (await a.request.get('/api/journal/trade')).json();
  expect(ownTrades.trades).toHaveLength(1);
  const tradeId = ownTrades.trades[0].id;
  await a.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(a.getByRole('button').filter({ hasText: 'XAUUSD' })).toBeVisible();
  await a.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await expect(a.getByText('Net P&L', { exact: true })).toBeVisible();

  const emailB = uniqueEmail();
  await signup(page, emailB);
  const contextB = await browser.newContext({ baseURL: 'http://localhost:3137' });
  const b = await contextB.newPage();
  await b.goto(await emailLink(request, emailB));
  await b.getByRole('button', { name: 'Save and explore journal' }).click();
  const foreignTrades = await (await b.request.get('/api/journal/trade')).json();
  expect(foreignTrades.trades).toEqual([]);
  expect((await b.request.put('/api/journal/trade/' + tradeId, { data: { notes: 'stolen' } })).status()).toBe(404);
  expect((await b.request.delete('/api/journal/trade/' + tradeId)).status()).toBe(404);
  const apiKey = await (await a.request.post('/api/journal/keys')).json();
  expect(apiKey.key).toMatch(/^mf_/);
  expect((await b.request.delete('/api/journal/keys/' + apiKey.id)).status()).toBe(404);
  expect((await a.request.post('/api/journal/keys', { headers: { origin: 'https://foreign.test' } })).status()).toBe(403);

  const sync = () => request.post('/api/journal/ingest', { headers: { authorization: 'Bearer ' + apiKey.key }, data: { ea_version: 'auth-test', account_login: '123456', server: 'Test-Broker', currency: 'USD', trades: [] } });
  expect((await sync()).status()).toBe(200);
  expect((await (await b.request.get('/api/journal/accounts')).json()).accounts).toEqual([]);
  const idA = await ownerId(emailA);
  await admin.from('journal_access').update({ status: 'revoked' }).eq('user_id', idA);
  expect((await a.request.get('/api/journal/trade')).status()).toBe(403);
  expect((await sync()).status()).toBe(403);
  await a.goto('/journal');
  await expect(a).toHaveURL(/\/journal-access$/);
  await admin.from('journal_access').update({ status: 'active' }).eq('user_id', idA);
  expect((await sync()).status()).toBe(200);
  await admin.from('journal_access').delete().eq('user_id', idA);
  expect((await a.request.get('/api/journal/trade')).status()).toBe(503);
  await admin.from('journal_access').insert({ user_id: idA, status: 'active', source: 'beta' });

  const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  expect((await anon.from('journal_access').select('*')).error).toBeTruthy();
  expect((await anon.from('profiles').update({ display_name: 'attacker' }).eq('id', idA)).error).toBeTruthy();
  await admin.auth.admin.updateUserById(idA, { ban_duration: '1h' });
  expect((await sync()).status()).toBe(403);
  expect((await a.request.get('/api/journal/trade')).status()).toBe(401);
  await admin.auth.admin.updateUserById(idA, { ban_duration: 'none' });

  // A fresh login restores the browser after the intentional ban invalidates its session.
  await login(a, emailA);
  await expect(a).toHaveURL(/\/journal$/);
  await a.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(a).toHaveURL(/\/login$/);
  expect((await a.request.get('/api/journal/trade')).status()).toBe(401);
  expect((await sync()).status()).toBe(200);
  expect((await b.request.get('/api/journal/trade')).status()).toBe(200);
  expect((await request.get('/api/journal/trade', { headers: { cookie: 'sb-access-token=forged' } })).status()).toBe(401);
  await a.goto(confirmation);
  await expect(a).toHaveURL(/\/check-email\?error=invalid-link$/);
  await contextA.close();
  await contextB.close();
});

test('standard Supabase confirmation exchanges its code and opens the journal', async ({ page, request }) => {
  const email = uniqueEmail();
  await signup(page, email);
  await page.goto(await emailLink(request, email, false, true));
  await expect(page.getByRole('heading', { name: 'Welcome to your journal' })).toBeVisible();
  expect((await page.request.get('/api/journal/session')).status()).toBe(200);
});

test('standard Supabase recovery opens password reset using the SDK recovery marker', async ({ page, request }) => {
  const email = uniqueEmail();
  expect((await admin.auth.admin.createUser({ email, password, email_confirm: true })).error).toBeNull();
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If this email');
  await page.goto(await emailLink(request, email, true, true));
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole('button', { name: 'Save new password' })).toBeVisible();
});

test('email recovery changes the password and requires a fresh sign-in', async ({ page, request }) => {
  const email = uniqueEmail();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If this email');
  await page.goto(await emailLink(request, email, true));
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel('New password', { exact: true }).fill('Changed-MacroFlow-2026!');
  await page.getByLabel('Confirm password', { exact: true }).fill('Changed-MacroFlow-2026!');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/login\?notice=password-updated$/);
  await login(page, email);
  await expect(page.getByRole('alert')).toBeVisible();
  await login(page, email, 'Changed-MacroFlow-2026!');
  await expect(page).toHaveURL(/\/journal\/welcome$/);
});

test('open journal tabs discard drafts during logout and account switching', async ({ page, context }) => {
  const emailA = uniqueEmail();
  const emailB = uniqueEmail();
  expect((await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true })).error).toBeNull();
  expect((await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true })).error).toBeNull();
  await login(page, emailA);
  await page.getByRole('button', { name: 'Save and explore journal' }).click();
  await expect(page).toHaveURL(/\/journal\?tab=log$/);
  await provisionManualAccount(page);
  const retained = await context.newPage();
  await retained.goto('/journal');
  await retained.getByLabel('Entry price', { exact: true }).fill('987654');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(retained).toHaveURL(/\/login$/);
  await login(page, emailB);
  await page.getByRole('button', { name: 'Save and explore journal' }).click();
  await expect(page).toHaveURL(/\/journal\?tab=log$/);
  await provisionManualAccount(page);
  await retained.goto('/journal');
  await expect(retained.getByLabel('Entry price', { exact: true })).toHaveValue('');
  await retained.getByLabel('Entry price', { exact: true }).fill('123456');
  // Sign in directly as another account without signing out first.
  await login(page, emailA);
  await expect(page).toHaveURL(/\/journal$/);
  await expect(retained).toHaveURL(/\/login$/);
  await retained.goto('/journal');
  await retained.getByLabel('Entry price', { exact: true }).fill('456789');
  // Simulate a suspended tab missing cross-tab notifications; focus must recheck.
  await retained.evaluate(() => window.addEventListener('storage', (event) => event.stopImmediatePropagation(), true));
  await page.bringToFront();
  await login(page, emailB);
  await expect(page).toHaveURL(/\/journal$/);
  const staleMutation = await retained.request.post('/api/journal/keys', { headers: { 'x-journal-user': await ownerId(emailA) } });
  expect(staleMutation.status()).toBe(409);
  await retained.bringToFront();
  await expect(retained).toHaveURL(/\/login$/);
});

test('journal workspace supports responsive layouts, accessible tabs, and trade review', async ({ page }) => {
  const email = uniqueEmail();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  const owner = data.user!.id;
  const seeded = await admin.from('trades').insert([
    { user_id: owner, symbol: 'XAUUSD', direction: 'long', entry_price: 2700, exit_price: 2727, result: 'win', pnl_percent: 1, pnl_amount: 120, setup_tags: ['Breakout'], notes: 'Waited for the planned entry.', closed_at: new Date().toISOString() },
    { user_id: owner, symbol: 'GBPUSD', direction: 'short', entry_price: 1.295, exit_price: 1.3, result: 'loss', pnl_percent: -0.386, pnl_amount: -50, setup_tags: [], notes: 'Review the entry timing.', closed_at: new Date().toISOString() },
  ]);
  expect(seeded.error).toBeNull();
  const artifacts = path.resolve('.artifacts/ui-review');
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Welcome to your journal' })).toBeVisible();
  async function audit() {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  }
  await audit();
  await page.getByRole('button', { name: 'Save and explore journal' }).click();
  await expect(page.getByRole('heading', { name: 'Capture the trade' })).toBeVisible();
  await audit();
  await page.screenshot({ path: path.join(artifacts, 'journal-desktop.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Log Trade', exact: true }).click();
    await expect(page.getByLabel('Entry price', { exact: true })).toBeVisible();
    await audit();
    if (width === 375) await page.screenshot({ path: path.join(artifacts, 'journal-mobile.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('tab', { name: 'Log Trade', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toBeFocused();
    const trade = page.getByRole('button').filter({ hasText: 'XAUUSD' });
    await expect(trade).toBeVisible();
    await audit();
    await trade.click();
    await expect(page.getByText('Waited for the planned entry.')).toBeVisible();
    await audit();
    await page.screenshot({ path: path.join(artifacts, `history-${width}.png`), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
    await expect(page.getByRole('paragraph').filter({ hasText: /^Net P&L$/ })).toBeVisible();
    await audit();
    await page.screenshot({ path: path.join(artifacts, `analytics-${width}.png`), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bring your trades together' })).toBeVisible();
    await expect(page.getByText('Loading accounts…')).toHaveCount(0);
    await audit();
    if (width === 1440) await page.screenshot({ path: path.join(artifacts, 'mt5-connection.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  }
  expect(errors).toEqual([]);
});

test('concurrent SSR refresh preserves isolated users past their original token expiry', async ({ browser }) => {
  test.setTimeout(420_000);
  const owners = [];
  for (let index = 0; index < 2; index++) {
    const email = uniqueEmail();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    const context = await browser.newContext({ baseURL: 'http://localhost:3137' });
    const page = await context.newPage();
    await login(page, email);
    await page.getByRole('button', { name: 'Save and explore journal' }).click();
    await expect(page.getByText('Free beta', { exact: true })).toBeVisible();
    const cookies = (await context.cookies()).filter((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a, b) => a.name.localeCompare(b.name));
    const encoded = cookies.map((cookie) => cookie.value).join('').replace(/^base64-/, '');
    const token = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).access_token as string;
    const expiry = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp as number;
    owners.push({ page, context, cookies, expiry, userId: data.user!.id });
  }
  await expect.poll(() => Math.floor(Date.now() / 1000), { timeout: 350_000, intervals: [1000] }).toBeGreaterThan(Math.max(...owners.map((owner) => owner.expiry)));
  // Same-cookie requests overlap for each user, while both users refresh independently.
  await Promise.all(owners.flatMap((owner) => Array.from({ length: 6 }, async () => {
    const response = await owner.page.request.get('/api/journal/session');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toEqual({ userId: owner.userId });
  })));
  for (const owner of owners) {
    const rotated = (await owner.context.cookies()).filter((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name));
    expect(rotated.map((cookie) => cookie.value).join('')).not.toBe(owner.cookies.map((cookie) => cookie.value).join(''));
    // The final cookie jar must still work after overlapping response updates.
    expect(await (await owner.page.request.get('/api/journal/session')).json()).toEqual({ userId: owner.userId });
    await owner.page.reload();
    await expect(owner.page.getByText('Free beta', { exact: true })).toBeVisible();
    await owner.context.close();
  }
});


test('weekly review and private screenshots preserve owner isolation and cleanup', async ({ page, browser }) => {
  const email = uniqueEmail();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  const userId = data.user!.id;
  await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', userId);
  await login(page, email);
  await expect(page).toHaveURL(/\/journal$/);
  const created = await page.request.post('/api/journal/trade', { data: { symbol: 'XAUUSD', direction: 'long', entryPrice: 100, exitPrice: 110, result: 'win', notes: 'Waited for the planned entry.', setupTags: ['Sweep'] } });
  expect(created.status()).toBe(201);
  const tradeId = (await created.json()).trade.id;
  const endpoint = '/api/journal/trade/' + tradeId + '/screenshots';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV7sAAAAASUVORK5CYII=', 'base64');
  const upload = () => page.request.post(endpoint, { multipart: { image: { name: 'entry.png', mimeType: 'image/png', buffer: image } } });
  expect((await upload()).status()).toBe(201);
  const imageResponse = await page.request.get(endpoint + '?slot=0');
  expect(imageResponse.status()).toBe(200); expect(imageResponse.headers()['cache-control']).toContain('no-store');
  expect(await imageResponse.body()).toEqual(image);
  const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  expect((await anon.storage.from('journal-screenshots').download(userId + '/' + tradeId + '/0')).error).toBeTruthy();
  const signed = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  expect((await signed.auth.signInWithPassword({ email, password })).error).toBeNull();
  expect((await signed.storage.from('journal-screenshots').download(userId + '/' + tradeId + '/0')).error).toBeTruthy();
  const otherContext = await browser.newContext({ baseURL: 'http://localhost:3137' });
  const other = await otherContext.newPage();
  const emailB = uniqueEmail(); await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  await login(other, emailB);
  await expect(other).toHaveURL(/\/journal\/welcome$/);
  expect((await other.request.get(endpoint)).status()).toBe(404);
  expect((await other.request.get(endpoint + '?slot=0')).status()).toBe(404);
  expect((await other.request.delete(endpoint + '?slot=0')).status()).toBe(404);
  const foreignReview = await (await other.request.get('/api/journal/review')).json(); expect(foreignReview.review.trades).toEqual([]);
  const concurrent = await Promise.all([upload(), upload(), upload(), upload()]);
  expect(concurrent.map((r) => r.status()).sort()).toEqual([201, 201, 409, 409]);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'XAUUSD' }).click();
  await expect(page.getByRole('img', { name: 'Trade screenshot 1', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Weekly Review', exact: true }).click();
  await expect(page.getByText('Waited for the planned entry.', { exact: true })).toBeVisible();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    await page.screenshot({ path: path.resolve('.artifacts/ui-review/weekly-review-' + width + '.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  }
  expect((await page.request.delete('/api/journal/trade/' + tradeId)).status()).toBe(204);
  expect((await admin.storage.from('journal-screenshots').list(userId + '/' + tradeId)).data).toEqual([]);
  await otherContext.close();
});
