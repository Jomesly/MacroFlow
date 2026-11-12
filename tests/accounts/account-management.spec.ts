import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const statusFile = process.env.MACROFLOW_ACCOUNT_TEST_STATUS;
if (!statusFile) throw new Error('Start scripts/start-account-eval.ps1 and set MACROFLOW_ACCOUNT_TEST_STATUS to its local status.json.');
const local = JSON.parse(readFileSync(statusFile, 'utf8').replace(/^\uFEFF/, '')) as Record<string, string>;
if (!['http://127.0.0.1:55421', 'http://127.0.0.1:55621'].includes(local.API_URL)) throw new Error('Account tests require a disposable local evaluation project on port 55421 or 55621.');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'MacroFlow-Account-Test-2026!';
const origin = process.env.MACROFLOW_ACCOUNT_TEST_BASE_URL || 'http://localhost:3001';
const operation = (version = 1) => ({ expectedVersion: version, operationId: crypto.randomUUID() });
let users: string[] = [];

test.beforeAll(async ({ request }) => {
  const response = await request.get('/api/account');
  expect(response.headers()['x-macroflow-local-evaluation'], 'Refusing to test a server outside the isolated local evaluator.').toBe('true');
  expect(response.status()).toBe(401);
});

async function createOwner() {
  const email = `account-${crypto.randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('Local fixture creation failed.');
  users.push(data.user.id);
  const saved = await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', data.user.id);
  if (saved.error) throw saved.error;
  return { id: data.user.id, email };
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/journal$/);
}

async function keyFor(page: Page) {
  const response = await page.request.post('/api/journal/keys', { headers: { origin } });
  expect(response.status()).toBe(201);
  return (await response.json()).key as string;
}

function sync(request: APIRequestContext, key: string, login = '555001', ticket = 'ticket-1') {
  return request.post('/api/journal/ingest', {
    headers: { authorization: 'Bearer ' + key },
    data: { ea_version: 'account-test', account_login: login, server: 'Test-Broker', currency: 'USD', trades: [{
      ticket, symbol: 'XAUUSD', side: 'buy', volume: 0.1,
      entry_time: 1793520000, exit_time: 1793523600, entry_price: 2600, exit_price: 2610, profit: 10,
    }] },
  });
}

test.afterEach(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  users = [];
});

test('edit, pause, keep history, reconnect, and permanently erase account trades', async ({ page, request }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  const manual = await page.request.post('/api/journal/trade', { headers: { origin }, data: { symbol: 'XAUUSD', direction: 'long', entryPrice: 2500, notes: 'Manual trade' } });
  expect(manual.ok()).toBe(true);
  await page.goto('/journal?tab=accounts');
  let card = page.getByRole('article', { name: 'Trading account 555001', exact: true });
  await expect(card.getByText('1 trade', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Edit details' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Display name').fill('Main account');
  await dialog.getByLabel('Notes').fill('Keep this note through sync.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  card = page.getByRole('article', { name: 'Trading account Main account', exact: true });
  await expect(card.getByText('Keep this note through sync.')).toBeVisible();
  expect((await sync(request, key)).status()).toBe(200);
  await card.getByRole('button', { name: 'Pause sync' }).click();
  await expect(card.getByRole('button', { name: 'Resume sync' })).toBeVisible();
  const paused = await sync(request, key);
  expect(paused.status()).toBe(409);
  expect((await paused.json()).code).toBe('ACCOUNT_PAUSED');
  await card.getByRole('button', { name: 'Resume sync' }).click();
  await expect(card.getByRole('button', { name: 'Pause sync' })).toBeVisible();
  await card.getByRole('button', { name: 'Remove account', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Main account', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Keep journal history/ })).toBeChecked();
  // Native modal supports Escape without performing a mutation.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await card.getByRole('button', { name: 'Remove account', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove account', exact: true }).click();
  await expect(page.getByText('No connected trading accounts', { exact: true })).toBeVisible();
  const removed = await sync(request, key);
  expect(removed.status()).toBe(409);
  expect((await removed.json()).code).toBe('ACCOUNT_REMOVED');
  let trades = await (await page.request.get('/api/journal/trade')).json();
  expect(trades.trades).toHaveLength(2);
  await page.getByText('Removed accounts (1)', { exact: true }).click();
  card = page.getByRole('article', { name: 'Trading account 555001', exact: true });
  await card.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reconnect account' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('No connected trading accounts', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '555001', exact: true })).toBeVisible();
  expect((await sync(request, key)).status()).toBe(200);
  trades = await (await page.request.get('/api/journal/trade')).json();
  expect(trades.trades).toHaveLength(2);
  card = page.getByRole('article', { name: 'Trading account 555001', exact: true });
  await card.getByRole('button', { name: 'Remove account', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Delete imported trades too/ }).check();
  await expect(dialog.getByRole('button', { name: 'Remove and delete trades' })).toBeDisabled();
  await dialog.getByLabel('Type 555001 to confirm').fill('555001');
  await dialog.getByRole('button', { name: 'Remove and delete trades' }).click();
  await expect(dialog).not.toBeVisible();
  trades = await (await page.request.get('/api/journal/trade')).json();
  expect(trades.trades).toHaveLength(1);
  expect(trades.trades[0].notes).toBe('Manual trade');
});

test('ownership, origin, validation, and concurrent sync/removal protect account data', async ({ page, request, browser }) => {
  const a = await createOwner();
  const b = await createOwner();
  await login(page, a.email);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  const accounts = await (await page.request.get('/api/journal/accounts')).json();
  const id = accounts.accounts[0].id;
  const url = `/api/journal/accounts/${id}`;
  const context = await browser.newContext({ baseURL: origin });
  const other = await context.newPage();
  await login(other, b.email);
  expect((await other.request.patch(url, { headers: { origin }, data: { ...operation(), action: 'pause' } })).status()).toBe(404);
  expect((await other.request.delete(url, { headers: { origin }, data: { ...operation(), deleteTrades: false } })).status()).toBe(404);
  expect((await other.request.post(url + '/reconnect', { headers: { origin }, data: operation() })).status()).toBe(404);
  expect((await page.request.delete(url, { headers: { origin: 'https://foreign.test' }, data: { ...operation(), deleteTrades: false } })).status()).toBe(403);
  expect((await page.request.patch(url, { headers: { origin }, data: { ...operation(), action: 'edit', displayName: '', notes: '', account_login: 'changed' } })).status()).toBe(400);
  expect((await page.request.delete(url, { headers: { origin }, data: { ...operation(), deleteTrades: true, confirmation: 'wrong' } })).status()).toBe(400);
  expect((await page.request.patch(url, { headers: { origin, 'x-journal-user': b.id }, data: { ...operation(), action: 'pause' } })).status()).toBe(409);
  for (let i = 0; i < 4; i++) {
    const login = `race-${i}`;
    expect((await sync(request, key, login)).status()).toBe(200);
    const current = await (await page.request.get('/api/journal/accounts')).json();
    const account = current.accounts.find((entry: { account_login: string }) => entry.account_login === login);
    const responses = await Promise.all([
      ...Array.from({ length: 3 }, (_, n) => sync(request, key, login, `concurrent-${n}`)),
      page.request.delete(`/api/journal/accounts/${account.id}`, { headers: { origin }, data: { ...operation(account.management_version), deleteTrades: true, confirmation: login } }),
    ]);
    expect(responses.at(-1)?.status()).toBe(200);
    for (const response of responses.slice(0, -1)) expect([200, 409]).toContain(response.status());
    expect((await sync(request, key, login)).status()).toBe(409);
    const remaining = await admin.from('trades').select('id').eq('user_id', a.id).eq('broker_account_id', account.id);
    expect(remaining.error).toBeNull();
    expect(remaining.data).toEqual([]);
  }
  await context.close();
});

test('full deletion verifies the password, works with revoked access, and cascades only owned data', async ({ page, request }) => {
  const owner = await createOwner();
  const other = await createOwner();
  await login(page, owner.email);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  const connection = await admin.from('broker_connections').insert({ user_id: owner.id, broker: 'test', api_key: 'local-only', api_secret_encrypted: 'local-only' });
  expect(connection.error).toBeNull();
  expect((await page.request.delete('/api/account', { headers: { origin: 'https://foreign.test' }, data: { password, confirmation: 'DELETE' } })).status()).toBe(403);
  expect((await page.request.delete('/api/account', { headers: { origin, 'x-journal-user': other.id }, data: { password, confirmation: 'DELETE' } })).status()).toBe(409);
  await admin.from('journal_access').update({ status: 'revoked' }).eq('user_id', owner.id);
  expect((await page.request.get('/api/journal/trade')).status()).toBe(403);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Current password').fill('incorrect-password');
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('password is incorrect');
  await dialog.getByLabel('Current password').fill(password);
  await dialog.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
  await expect(page).toHaveURL(/\/account-deleted$/);
  expect((await page.request.get('/api/account')).status()).toBe(401);
  expect((await sync(request, key)).status()).toBe(401);
  expect((await admin.auth.admin.getUserById(owner.id)).data.user).toBeNull();
  expect((await admin.auth.admin.getUserById(other.id)).data.user?.id).toBe(other.id);
  for (const table of ['trades', 'broker_accounts', 'broker_connections', 'journal_api_keys', 'journal_access']) {
    const rows = await admin.from(table).select('*').eq('user_id', owner.id);
    expect(rows.error).toBeNull(); expect(rows.data).toEqual([]);
  }
  expect((await admin.from('profiles').select('*').eq('id', owner.id)).data).toEqual([]);
});

test('pending full deletion freezes writes and can be retried from account settings', async ({ page, request }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  const prepare = await admin.rpc('prepare_journal_user_deletion', { p_user_id: owner.id });
  expect(prepare.error).toBeNull();
  expect((await page.request.get('/api/journal/trade')).status()).toBe(403);
  expect((await sync(request, key)).status()).toBe(401);
  const lateWrite = await admin.from('trades').insert({ user_id: owner.id, symbol: 'XAUUSD', direction: 'long', entry_price: 2600 });
  expect(lateWrite.error?.message).toBe('ACCOUNT_DELETING');
  await page.goto('/journal');
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: 'Finish account deletion', exact: true }).click();
  await page.getByLabel('Current password').fill(password);
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Permanently delete account', exact: true }).click();
  await expect(page).toHaveURL(/\/account-deleted$/);
});

test('active legacy billing blocks deletion before freezing journal access', async ({ page }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const subscription = await admin.from('subscribers').insert({ id: owner.id, email: owner.email, status: 'active', stripe_customer_id: 'cus_local_only' });
  expect(subscription.error).toBeNull();
  const response = await page.request.delete('/api/account', { headers: { origin }, data: { password, confirmation: 'DELETE' } });
  expect(response.status()).toBe(409);
  expect((await response.json()).code).toBe('BILLING_REVIEW_REQUIRED');
  expect((await page.request.get('/api/journal/trade')).status()).toBe(200);
});

test('account actions and dialogs fit a mobile viewport', async ({ page, request }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/journal?tab=accounts');
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('stale confirmation stays stale after polling and purge retries cannot erase reconnected trades', async ({ page, request }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  await page.clock.install();
  await page.goto('/journal?tab=accounts');
  const card = page.getByRole('article', { name: 'Trading account 555001', exact: true });
  await card.getByRole('button', { name: 'Remove account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Delete imported trades too/ }).check();
  await dialog.getByLabel('Type 555001 to confirm').fill('555001');
  const original = (await (await page.request.get('/api/journal/accounts')).json()).accounts[0];
  const url = `/api/journal/accounts/${original.id}`;
  expect((await page.request.patch(url, { headers: { origin }, data: { ...operation(original.management_version), action: 'edit', displayName: 'Changed elsewhere', notes: '' } })).status()).toBe(200);
  const refresh = page.waitForResponse((response) => response.url().endsWith('/api/journal/accounts') && response.request().method() === 'GET');
  await page.clock.fastForward(60001);
  await refresh;
  await expect(page.getByRole('heading', { name: 'Changed elsewhere', exact: true })).toBeVisible();
  const submission = page.waitForRequest((req) => req.method() === 'DELETE' && req.url().endsWith(url));
  await dialog.getByRole('button', { name: 'Remove and delete trades' }).click();
  expect((await submission).postDataJSON().expectedVersion).toBe(original.management_version);
  await expect(dialog.getByRole('alert')).toContainText('This account changed');
  await expect(dialog.getByRole('button', { name: 'Remove and delete trades' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const purge = { ...operation(original.management_version + 1), deleteTrades: true, confirmation: '555001' };
  const first = await page.request.delete(url, { headers: { origin }, data: purge });
  expect(first.status()).toBe(200);
  const receipt = await first.json();
  const retry = await page.request.delete(url, { headers: { origin }, data: purge });
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual(receipt);
  expect((await page.request.post(url + '/reconnect', { headers: { origin }, data: operation(receipt.managementVersion) })).status()).toBe(200);
  expect((await sync(request, key, '555001', 'after-reconnect')).status()).toBe(200);
  const replay = await page.request.delete(url, { headers: { origin }, data: purge });
  expect(replay.status()).toBe(409);
  expect((await replay.json()).code).toBe('ACCOUNT_STATE_CHANGED');
  const remaining = await admin.from('trades').select('id').eq('user_id', owner.id);
  expect(remaining.error).toBeNull(); expect(remaining.data).toHaveLength(1);
});

test('concurrent API key creation enforces the limit and revocation takes effect', async ({ page, request }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const responses = await Promise.all(Array.from({ length: 5 }, () => page.request.post('/api/journal/keys', { headers: { origin } })));
  expect(responses.filter((response) => response.status() === 201)).toHaveLength(3);
  expect(responses.filter((response) => response.status() === 400)).toHaveLength(2);
  const created = await responses.find((response) => response.status() === 201)!.json();
  expect((await page.request.delete(`/api/journal/keys/${created.id}`, { headers: { origin } })).status()).toBe(204);
  expect((await sync(request, created.key)).status()).toBe(401);
  expect((await page.request.post('/api/journal/keys', { headers: { origin } })).status()).toBe(201);
});

test('profile saves and ordinary trade edits/deletes work through guarded writes', async ({ page, request }) => {
  const owner = await createOwner();
  await login(page, owner.email);
  const before = await admin.from('profiles').select('onboarding_completed_at').eq('id', owner.id).single();
  expect(before.error).toBeNull();
  await page.goto('/journal/welcome');
  await page.getByLabel('Display name (optional)').fill('Guarded preferences');
  await page.getByLabel('Preferred reporting timezone').fill('Asia/Manila');
  await page.getByRole('button', { name: 'Save and explore journal' }).click();
  await expect(page).toHaveURL(/\/journal(?:\?tab=log)?$/);
  const saved = await admin.from('profiles').select('display_name,reporting_timezone,onboarding_completed_at').eq('id', owner.id).single();
  expect(saved.error).toBeNull();
  expect(saved.data).toMatchObject({ display_name: 'Guarded preferences', reporting_timezone: 'Asia/Manila', onboarding_completed_at: before.data!.onboarding_completed_at });
  const created = await page.request.post('/api/journal/trade', { headers: { origin }, data: { symbol: 'XAUUSD', direction: 'long', entryPrice: 2500 } });
  expect(created.status()).toBe(201);
  const trade = (await created.json()).trade;
  const tradeUrl = `/api/journal/trade/${trade.id}`;
  expect((await page.request.put(tradeUrl, { headers: { origin }, data: { exitPrice: 2525 } })).status()).toBe(400);
  const edited = await page.request.put(tradeUrl, { headers: { origin }, data: { expectedRevision: 1, exitPrice: 2525, closedAt: new Date().toISOString(), result: 'win', notes: 'Closed manually' } });
  expect(edited.status()).toBe(200);
  expect((await edited.json()).trade).toMatchObject({ pnlPercent: 1, notes: 'Closed manually' });
  expect((await page.request.delete(tradeUrl, { headers: { origin } })).status()).toBe(204);
  expect((await page.request.delete(tradeUrl, { headers: { origin } })).status()).toBe(404);
  const key = await keyFor(page);
  expect((await sync(request, key)).status()).toBe(200);
  const account = (await (await page.request.get('/api/journal/accounts')).json()).accounts[0];
  expect((await page.request.delete(`/api/journal/accounts/${account.id}`, { headers: { origin }, data: { ...operation(account.management_version), deleteTrades: false } })).status()).toBe(200);
  const retained = (await (await page.request.get('/api/journal/trade')).json()).trades[0];
  const historyEdit = await page.request.put(`/api/journal/trade/${retained.id}`, { headers: { origin }, data: { notes: 'Reviewed after removal', setupTags: ['reviewed'] } });
  expect(historyEdit.status()).toBe(200);
  expect((await historyEdit.json()).trade).toMatchObject({ notes: 'Reviewed after removal', setupTags: ['reviewed'] });
});
