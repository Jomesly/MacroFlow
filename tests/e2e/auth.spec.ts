import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Deliberately no .env.local fallback: these tests must never mutate a hosted project.
const statusFile = process.env.MACROFLOW_AUTH_TEST_STATUS;
if (!statusFile) throw new Error('Run scripts/test-auth-local.ps1, or set MACROFLOW_AUTH_TEST_STATUS to isolated local Supabase status JSON.');
const local = JSON.parse(readFileSync(statusFile, 'utf8').replace(/^\uFEFF/, '')) as Record<string, string>;
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(local.API_URL)) throw new Error('Auth tests require the disposable local Supabase on port 55321.');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'MacroFlow-Test-2026!';
const uniqueEmail = () => 'journal-' + crypto.randomUUID() + '@example.test';

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
  await a.getByLabel('Symbol', { exact: true }).selectOption('XAUUSD');
  await a.getByRole('button', { name: 'Long', exact: true }).click();
  await a.getByLabel('Entry Price', { exact: true }).fill('2700');
  await a.getByRole('button', { name: 'Log Trade', exact: true }).last().click();
  await expect(a.getByText('Trade logged', { exact: false })).toBeVisible();
  const ownTrades = await (await a.request.get('/api/journal/trade')).json();
  expect(ownTrades.trades).toHaveLength(1);
  const tradeId = ownTrades.trades[0].id;
  await a.getByRole('button', { name: 'History', exact: true }).click();
  await expect(a.getByText('XAUUSD', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Analytics', exact: true }).click();
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
  const retained = await context.newPage();
  await retained.goto('/journal');
  await retained.getByLabel('Entry Price', { exact: true }).fill('987654');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(retained).toHaveURL(/\/login$/);
  await login(page, emailB);
  await page.getByRole('button', { name: 'Save and explore journal' }).click();
  await retained.goto('/journal');
  await expect(retained.getByLabel('Entry Price', { exact: true })).toHaveValue('');
  await retained.getByLabel('Entry Price', { exact: true }).fill('123456');
  // Sign in directly as another account without signing out first.
  await login(page, emailA);
  await expect(page).toHaveURL(/\/journal$/);
  await expect(retained).toHaveURL(/\/login$/);
  await retained.goto('/journal');
  await retained.getByLabel('Entry Price', { exact: true }).fill('456789');
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
