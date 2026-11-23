import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { admin, assertLocal, createOwner, createTrade, endpoint, list, local, login, origin, password, png, upload } from './helpers';

let users: string[] = [];
test.beforeAll(async ({ request }) => assertLocal(request));
test.afterEach(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  users = [];
});

test('repeated completed uploads consume the attempt limit before image decoding', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  const operation = crypto.randomUUID();
  const bytes = await png();
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await upload(page.request, trade, bytes, operation);
    expect(response.status(), await response.text()).toBe(201);
  }
  const throttled = await upload(page.request, trade, bytes.subarray(0, 45), operation);
  expect(throttled.status()).toBe(429);
  expect(throttled.headers()['retry-after']).toBe('60');
  expect(await list(page.request, trade)).toHaveLength(1);
});

test('private persisted image, idempotent retry, owner isolation and bounded validation', async ({ page, request, browser }) => {
  const owner = await createOwner(); users.push(owner.id);
  const other = await createOwner(); users.push(other.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  const image = await png();
  const operation = crypto.randomUUID();
  const saved = await upload(page.request, trade, image, operation);
  expect(saved.status(), await saved.text()).toBe(201);
  const screenshots = await list(page.request, trade);
  expect(screenshots).toHaveLength(1);
  const original = screenshots[0];
  expect(original.id).toMatch(/^[\da-f-]{36}$/);
  const downloaded = await page.request.get(original.url);
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()['cache-control']).toContain('no-store');
  expect(downloaded.headers()['x-content-type-options']).toBe('nosniff');
  expect((await sharp(await downloaded.body()).metadata()).width).toBe(640);
  const retry = await upload(page.request, trade, image, operation);
  expect([200, 201]).toContain(retry.status());
  expect((await list(page.request, trade)).map(row => row.id)).toEqual([original.id]);
  const different = await sharp({ create: { width: 80, height: 60, channels: 3, background: 'red' } }).png().toBuffer();
  expect((await upload(page.request, trade, different, operation)).status()).toBe(409);

  expect((await request.get(endpoint(trade))).status()).toBe(401);
  expect((await request.get(original.url)).status()).toBe(401);
  const context = await browser.newContext({ baseURL: origin });
  const otherPage = await context.newPage();
  await login(otherPage, other.email);
  expect((await otherPage.request.get(endpoint(trade))).status()).toBe(404);
  expect((await otherPage.request.get(original.url)).status()).toBe(404);
  expect((await upload(otherPage.request, trade, image)).status()).toBe(404);
  expect((await otherPage.request.delete(`${endpoint(trade)}?imageId=${original.id}`, { headers: { origin } })).status()).toBe(404);
  await context.close();
  expect((await page.request.post(endpoint(trade), { headers: { origin: 'https://foreign.test' }, multipart: { image: { name: 'image.png', mimeType: 'image/png', buffer: image }, clientUploadId: crypto.randomUUID() } })).status()).toBe(403);
  const record = await admin.from('journal_trade_screenshots').select('object_path').eq('id', original.id).single();
  expect(record.error).toBeNull();
  const publicObject = await request.get(`${local.API_URL}/storage/v1/object/public/journal-screenshots/${record.data!.object_path}`);
  expect(publicObject.ok()).toBe(false);
  const direct = await request.get(`${local.API_URL}/storage/v1/object/authenticated/journal-screenshots/${record.data!.object_path}`, { headers: { apikey: local.ANON_KEY, authorization: `Bearer ${local.ANON_KEY}` } });
  expect(direct.ok()).toBe(false);
});

test('concurrent uploads enforce three slots and removing an image allows a new immutable image', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  const image = await png();
  const results = await Promise.all(Array.from({ length: 5 }, () => upload(page.request, trade, image)));
  expect(results.map(result => result.status()).sort()).toEqual([201, 201, 201, 409, 409]);
  const before = await list(page.request, trade);
  expect(before).toHaveLength(3);
  expect(new Set(before.map(row => row.slot)).size).toBe(3);
  const removed = before[0];
  expect((await page.request.delete(`${endpoint(trade)}?imageId=${removed.id}`, { headers: { origin } })).status()).toBe(204);
  expect((await page.request.get(removed.url)).status()).toBe(404);
  expect((await upload(page.request, trade, image)).status()).toBe(201);
  const after = await list(page.request, trade);
  expect(after).toHaveLength(3);
  expect(after.some(row => row.id === removed.id)).toBe(false);
  const metadata = await admin.from('journal_trade_screenshots').select('id,object_path,state').eq('trade_id', trade);
  expect(metadata.error).toBeNull();
  expect(new Set(metadata.data!.map(row => row.object_path)).size).toBe(metadata.data!.length);
  expect(metadata.data!.find(row => row.id === removed.id)?.state).toBe('deleting');
});

test('rejects unsupported, forged, truncated, oversized and excessive-dimension images', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  expect((await upload(page.request, trade, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), crypto.randomUUID(), 'image/svg+xml')).status()).toBe(400);
  expect((await upload(page.request, trade, Buffer.from('<html>not an image</html>'))).status()).toBe(400);
  expect((await upload(page.request, trade, (await png()).subarray(0, 30))).status()).toBe(400);
  expect((await upload(page.request, trade, Buffer.alloc(3 * 1024 * 1024 + 1))).status()).toBe(413);
  const huge = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: '#102030' } }).png().toBuffer();
  expect((await upload(page.request, trade, huge)).status()).toBe(400);
  expect(await list(page.request, trade)).toHaveLength(0);
});

test('single trade deletion revokes image access and keeps durable cleanup metadata', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  expect((await upload(page.request, trade, await png())).status()).toBe(201);
  const [screenshot] = await list(page.request, trade);
  expect((await page.request.delete(`/api/journal/trade/${trade}`, { headers: { origin } })).status()).toBe(204);
  expect((await page.request.get(screenshot.url)).status()).toBe(404);
  const metadata = await admin.from('journal_trade_screenshots').select('state,object_path').eq('id', screenshot.id).single();
  expect(metadata.error).toBeNull();
  expect(metadata.data?.state).toBe('deleting');
  expect(metadata.data?.object_path).toContain(`${owner.id}/${trade}/`);
});

test('MT5 retain keeps images and purge queues image removal', async ({ page, request }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const keyResponse = await page.request.post('/api/journal/keys', { headers: { origin } });
  expect(keyResponse.status()).toBe(201);
  const key = (await keyResponse.json()).key;
  const ingest = await request.post('/api/journal/ingest', { headers: { authorization: `Bearer ${key}` }, data: {
    ea_version: 'screenshot-test', account_login: '557001', server: 'Screenshot-Test', currency: 'USD',
    trades: [{ ticket: 'chart-1', symbol: 'XAUUSD', side: 'buy', volume: 0.1, entry_time: 1793520000, exit_time: 1793523600, entry_price: 2600, exit_price: 2610, profit: 10 }],
  } });
  expect(ingest.status(), await ingest.text()).toBe(200);
  const accounts = await (await page.request.get('/api/journal/accounts')).json();
  const account = accounts.accounts[0];
  const trades = await (await page.request.get('/api/journal/trade')).json();
  const trade = trades.trades[0].id;
  expect((await upload(page.request, trade, await png())).status()).toBe(201);
  const [screenshot] = await list(page.request, trade);
  const retained = await page.request.delete(`/api/journal/accounts/${account.id}`, { headers: { origin }, data: { expectedVersion: account.management_version, operationId: crypto.randomUUID(), deleteTrades: false } });
  expect(retained.status(), await retained.text()).toBe(200);
  expect((await page.request.get(screenshot.url)).status()).toBe(200);
  const current = (await (await page.request.get('/api/journal/accounts')).json()).removedAccounts[0];
  const reconnected = await page.request.post(`/api/journal/accounts/${account.id}/reconnect`, { headers: { origin }, data: { expectedVersion: current.management_version, operationId: crypto.randomUUID() } });
  expect(reconnected.status(), await reconnected.text()).toBe(200);
  const updated = (await (await page.request.get('/api/journal/accounts')).json()).accounts[0];
  const purged = await page.request.delete(`/api/journal/accounts/${account.id}`, { headers: { origin }, data: { expectedVersion: updated.management_version, operationId: crypto.randomUUID(), deleteTrades: true, confirmation: '557001' } });
  expect(purged.status(), await purged.text()).toBe(200);
  expect((await page.request.get(screenshot.url)).status()).toBe(404);
  expect((await admin.from('journal_trade_screenshots').select('state').eq('id', screenshot.id).single()).data?.state).toBe('deleting');
});

test('pending user deletion blocks uploads and full Auth deletion preserves cleanup records', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  expect((await upload(page.request, trade, await png())).status()).toBe(201);
  const [screenshot] = await list(page.request, trade);
  expect((await admin.rpc('prepare_journal_user_deletion', { p_user_id: owner.id })).error).toBeNull();
  expect((await upload(page.request, trade, await png())).status()).toBe(403);
  expect((await page.request.get(screenshot.url)).status()).toBe(403);
  const deleted = await page.request.delete('/api/account', { headers: { origin }, data: { password, confirmation: 'DELETE' } });
  expect(deleted.status(), await deleted.text()).toBe(200);
  expect((await admin.auth.admin.getUserById(owner.id)).data.user).toBeNull();
  const metadata = await admin.from('journal_trade_screenshots').select('state,object_path').eq('id', screenshot.id).single();
  expect(metadata.error).toBeNull();
  expect(metadata.data?.state).toBe('deleting');
  expect(metadata.data?.object_path).toContain(owner.id);
});
