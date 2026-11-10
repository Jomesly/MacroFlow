import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { readImportCsv, suggestImportMapping } from '../../src/lib/journal-import-parser';

const statusPath = process.env.MACROFLOW_AUTH_TEST_STATUS;
if (!statusPath) throw new Error('Set MACROFLOW_AUTH_TEST_STATUS to the disposable local Supabase status file.');
const local = JSON.parse(readFileSync(statusPath, 'utf8').replace(/^\uFEFF/, ''));
if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(local.API_URL)) throw new Error('Import tests only use isolated local Supabase.');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'MacroFlow-Imports-Test-2026!';
const artifacts = path.resolve('.artifacts/import-review');
async function setup(page: Page) {
  page.setDefaultTimeout(25000);
  const email = `imports-${crypto.randomUUID()}@example.test`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(user.error).toBeNull();
  const userId = user.data.user!.id;
  expect((await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', userId)).error).toBeNull();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeEnabled();
  const response = await page.request.post('/api/journal/trading-accounts', { data: { brokerName: 'IC Markets', accountNumber: '000123', nickname: 'Imported journal', currency: 'USD' } });
  expect(response.status()).toBe(201);
  const account = (await response.json()).account;
  await page.goto(`/journal?tradingAccount=${account.id}`);
  return { account, userId };
}
function payload(accountId: string, content: string, extra = {}) {
  return { filename: 'notion-journal.csv', content, target: { accountId }, options: { mapping: suggestImportMapping(readImportCsv(content).headers), timezone: 'Asia/Manila', netConfirmed: true }, ...extra };
}
async function preview(page: Page, body: object) {
  const response = await page.request.post('/api/journal/imports/preview', { data: body });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).preview;
}
async function commit(page: Page, id: string, rows: number[], keepDuplicates: number[] = []) {
  return page.request.post('/api/journal/imports/commit', { data: { id, rows, keepDuplicates } });
}
async function audit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

test('Notion CSV flow validates corrections, preserves unknown values, reports dates, and safely undoes edited batches', async ({ page }) => {
  const { account } = await setup(page);
  mkdirSync(artifacts, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByRole('button', { name: 'Import existing journal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import your journal', exact: true });
  await dialog.getByLabel('How should we handle capital?').selectOption('starting');
  await dialog.getByLabel('Balance · USD', { exact: true }).fill('1000');
  await dialog.getByLabel('Balance as of', { exact: true }).fill('2025-01-01T00:00');
  await audit(page);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  const csv = 'Date,Symbol,Direction,Result,Net P&L,Tags,Notes,Trade ID\r\n2025-01-13,Gold,Buy,Win,100,Patient setup,Good entry,one\r\n2025-01-14,GBPUSD,WRONG,Loss,-40,Breakout,Needs fix,two\r\n2025-01-15,BTCUSD,Sell,Breakeven,,Custom tag,Cash unknown,three\r\n2025-01-13,Gold,Buy,Win,100,Patient setup,Repeated ID,one';
  await dialog.getByLabel('Choose CSV file').setInputFiles({ name: 'notion-journal.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await dialog.getByRole('button', { name: 'Match columns', exact: true }).click();
  await dialog.getByLabel('Cash amounts are net of fees').check();
  await audit(page);
  await dialog.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(dialog.getByText('2 of 4 trades selected', { exact: true })).toBeVisible();
  await expect(dialog.getByText('1 already imported', { exact: true })).toBeVisible();
  const invalid = dialog.locator('.import-row').filter({ hasText: 'Row 3' });
  await invalid.getByText('View or correct source values', { exact: true }).click();
  await invalid.getByLabel('Direction', { exact: true }).fill('Sell');
  await expect(dialog.getByRole('button', { name: 'Import 2 trades' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();
  await expect(dialog.getByText('3 of 4 trades selected', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Balance after selected trades: 1,060.00 USD', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'review-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 900 });
  await audit(page);
  await page.screenshot({ path: path.join(artifacts, 'review-mobile.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Import 3 trades', exact: true }).click();
  await expect(page.getByRole('heading', { name: '3 trades added', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View imported trades', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  const trades = (await (await page.request.get(`/api/journal/trade?tradingAccount=${account.id}`)).json()).trades;
  expect(trades).toHaveLength(3);
  expect(trades.every((t: { entryPrice: number | null }) => t.entryPrice === null)).toBe(true);
  const unknown = trades.find((t: { importSourceId: string }) => t.importSourceId === 'three');
  expect(unknown.pnlAmount).toBeNull();
  expect(unknown.importInfo.datePrecision).toBe('date');
  const analytics = await (await page.request.get(`/api/journal/analytics?tradingAccount=${account.id}`)).json();
  expect(JSON.stringify(analytics)).toContain('2025-01-13');
  expect(JSON.stringify(analytics)).toContain('Unknown entry time');
  const edited = await page.request.put(`/api/journal/trade/${unknown.id}`, { data: { notes: 'Reviewed after import', expectedRevision: 1 } });
  expect(edited.status(), await edited.text()).toBe(200);
  const legacyEdit = await page.request.put(`/api/journal/trade/${unknown.id}`, { data: { notes: 'Reviewed with a legacy client' } });
  expect(legacyEdit.status(), await legacyEdit.text()).toBe(200);
  const staleEdit = await page.request.put(`/api/journal/trade/${unknown.id}`, { data: { notes: 'Stale overwrite', expectedRevision: 2 } });
  expect(staleEdit.status()).toBe(409);
  await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Undo import', exact: true }).click();
  await expect(page.getByText(/Remove 2 untouched trades/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove 2 trades', exact: true }).click();
  await expect(page.locator('.import-history').getByRole('status').filter({ hasText: '2 trades removed' })).toContainText('2 trades removed. 1 edited trades kept');
  const remaining = (await (await page.request.get(`/api/journal/trade?tradingAccount=${account.id}`)).json()).trades;
  expect(remaining).toHaveLength(1);
  const funds = await (await page.request.get(`/api/journal/trading-accounts/${account.id}/funds`)).json();
  expect(Number(funds.summary.balance)).toBe(1000);
  const tags = await (await page.request.get('/api/journal/setup-tags')).json();
  expect(tags.tags).toContain('Custom tag');
  await audit(page);
});

test('import transactions enforce ownership, snapshots, retries, concurrent duplicate checks and rollback', async ({ page }) => {
  const { account, userId } = await setup(page);
  const csv = 'Date,Symbol,Direction,Net P&L,Trade ID\n2025-01-13,XAUUSD,Buy,100,one\n2025-01-14,GBPUSD,Sell,-25,two';
  const opening = await page.request.post(`/api/journal/trading-accounts/${account.id}/funds`, { data: { requestId: crypto.randomUUID(), mutation: { action: 'set-opening', amount: '2000', effectiveAt: '2025-02-01T00:00:00Z', expectedVersion: 0 } } });
  expect(opening.status()).toBe(200);
  const [a, b] = await Promise.all([preview(page, payload(account.id, csv)), preview(page, payload(account.id, csv))]);
  const concurrent = await Promise.all([commit(page, a.id, [2, 3]), commit(page, b.id, [2, 3])]);
  expect(concurrent.map(r => r.status()).sort()).toEqual([200, 409]);
  const winner = concurrent[0].ok() ? a : b;
  const retry = await commit(page, winner.id, [3, 2]);
  expect(retry.status()).toBe(200);
  expect((await retry.json()).result.count).toBe(2);
  expect((await commit(page, winner.id, [2])).status()).toBe(409);
  const repeated = await preview(page, payload(account.id, csv));
  expect(repeated.rows.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);
  const funds = await (await page.request.get(`/api/journal/trading-accounts/${account.id}/funds`)).json();
  expect(Number(funds.summary.balance)).toBe(2000);
  const sameDay = await preview(page, payload(account.id, csv.replaceAll('2025-01-13', '2025-02-01').replaceAll('one', 'new-day')));
  expect(sameDay.rows[0].status).toBe('invalid');
  const overwrite = await page.request.post('/api/journal/imports/preview', { data: payload(account.id, csv, { opening: { mode: 'starting', amount: '1000', effectiveAt: '2024-01-01T00:00:00Z' } }) });
  expect(overwrite.status()).toBe(409);

  // A failed final row rolls back every trade and the new account/opening snapshot.
  const atomic = await preview(page, payload(account.id, csv, { target: { newAccount: { brokerName: 'Test firm', accountNumber: 'atomic', currency: 'USD' } }, opening: { mode: 'starting', amount: '1000', effectiveAt: '2025-01-01T00:00:00Z' } }));
  const staged = await admin.from('journal_import_rows').select('data').eq('batch_id', atomic.id).eq('row_number', 3).single();
  expect(staged.error).toBeNull();
  expect((await admin.from('journal_import_rows').update({ data: { ...staged.data!.data, netPnl: 'NaN' } }).eq('batch_id', atomic.id).eq('row_number', 3)).error).toBeNull();
  expect((await commit(page, atomic.id, [2, 3])).status()).toBe(400);
  expect((await admin.from('journal_accounts').select('id').eq('user_id', userId).eq('account_number', 'atomic')).data).toEqual([]);
  expect((await admin.from('trades').select('id').eq('import_batch_id', atomic.id)).data).toEqual([]);

  const foreign = await admin.auth.admin.createUser({ email: `foreign-import-${crypto.randomUUID()}@example.test`, password, email_confirm: true });
  const foreignAccount = await admin.from('journal_accounts').insert({ user_id: foreign.data.user!.id, broker_name: 'Other', account_number: 'foreign', currency: 'USD' }).select('id').single();
  expect(foreignAccount.error).toBeNull();
  expect((await page.request.post('/api/journal/imports/preview', { data: payload(foreignAccount.data!.id, csv) })).status()).toBe(404);
  expect((await admin.rpc('commit_journal_import', { p_user: foreign.data.user!.id, p_batch: winner.id, p_rows: [2, 3], p_keep: [] })).error?.code).toBe('42501');
  expect((await admin.rpc('undo_journal_import', { p_user: foreign.data.user!.id, p_batch: winner.id, p_expected: 2 })).error?.code).toBe('42501');
  const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  expect((await anon.from('journal_import_rows').select('*')).error).not.toBeNull();
  expect((await anon.rpc('commit_journal_import', { p_user: userId, p_batch: winner.id, p_rows: [2], p_keep: [] })).error).not.toBeNull();
  const undoConflict = await page.request.post(`/api/journal/imports/${winner.id}/undo`, { data: { expectedUntouched: 1 } });
  expect(undoConflict.status()).toBe(409);
});

test('new accounts commit atomically, possible duplicates require review and stale snapshots cannot commit', async ({ page }) => {
  const { account, userId } = await setup(page);
  const csv = 'Date,Symbol,Direction,Net P&L\n2025-01-13,XAUUSD,Buy,100';
  const next = await preview(page, payload(account.id, csv, { target: { newAccount: { brokerName: 'FTMO', accountNumber: '000555', nickname: 'From Notion', currency: 'USD' } }, opening: { mode: 'starting', amount: '1000', effectiveAt: '2025-01-01T00:00:00Z' } }));
  expect((await admin.from('journal_accounts').select('id').eq('user_id', userId).eq('account_number', '000555')).data).toEqual([]);
  const saved = await commit(page, next.id, [2]);
  expect(saved.status(), await saved.text()).toBe(200);
  const target = (await saved.json()).result.accountId;
  const details = await admin.from('journal_accounts').select('account_number,nickname').eq('id', target).single();
  expect(details.data).toEqual({ account_number: '000555', nickname: 'From Notion' });
  const balance = await (await page.request.get(`/api/journal/trading-accounts/${target}/funds`)).json();
  expect(Number(balance.summary.balance)).toBe(1100);
  const similar = await preview(page, payload(target, csv + '\n'));
  expect(similar.rows[0].status).toBe('possible');
  expect((await commit(page, similar.id, [2])).status()).toBe(409);
  expect((await commit(page, similar.id, [2], [2])).status()).toBe(200);
  const stale = await preview(page, payload(target, csv.replace('2025-01-13', '2025-01-14')));
  const correction = await page.request.post(`/api/journal/trading-accounts/${target}/funds`, { data: { requestId: crypto.randomUUID(), mutation: { action: 'set-opening', amount: '2000', effectiveAt: '2025-01-01T00:00:00Z', expectedVersion: 1, note: 'Correct source balance' } } });
  expect(correction.status()).toBe(200);
  expect((await commit(page, stale.id, [2])).status()).toBe(409);
  // Moving the snapshot onto a date-only close excludes uncertain cash and flags coverage.
  const moved = await page.request.post(`/api/journal/trading-accounts/${target}/funds`, { data: { requestId: crypto.randomUUID(), mutation: { action: 'set-opening', amount: '2000', effectiveAt: '2025-01-13T03:00:00Z', expectedVersion: 2, note: 'Known balance on trading day' } } });
  expect(moved.status()).toBe(200);
  const uncertain = await (await page.request.get(`/api/journal/trading-accounts/${target}/funds`)).json();
  expect(Number(uncertain.summary.balance)).toBe(2000);
  expect(uncertain.summary.missingDates).toBe(2);
  expect(uncertain.summary.complete).toBe(false);
  // In-file matching rows need the same explicit review, even for a new account.
  const repeated = await preview(page, payload(account.id, csv + '\n2025-01-13,XAUUSD,Buy,100'));
  expect(repeated.rows.map((r: { status: string }) => r.status)).toEqual(['ready', 'possible']);
  expect((await commit(page, repeated.id, [2, 3])).status()).toBe(409);
  expect((await commit(page, repeated.id, [2, 3], [3])).status()).toBe(200);
});
