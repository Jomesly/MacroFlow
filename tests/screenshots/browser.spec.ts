import { test, expect, chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { admin, assertLocal, createOwner, createTrade, endpoint, list, login, openEditor, origin, pasteImage, png, withNativeClipboard } from './helpers';

let users: string[] = [];
test.beforeAll(async ({ request }) => assertLocal(request));
test.afterEach(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  users = [];
});

test('browser Back can be cancelled without losing a failed screenshot preview', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  // Enter via a Next Link so Back is a client-side navigation, not beforeunload.
  await page.goto('/account');
  await page.getByRole('link', { name: 'Trading journal' }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.locator(`[aria-controls="trade-details-${trade}"]`).click();
  const details = page.locator(`#trade-details-${trade}`);
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(details.getByText('Loading screenshots…', { exact: true })).toHaveCount(0);
  await page.route(`**${endpoint(trade)}`, route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary test failure' }) })
    : route.continue());
  await pasteImage(page, trade, await png());
  await expect(details.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  let warnings = 0;
  let leave = false;
  page.on('dialog', async dialog => { warnings++; if (leave) await dialog.accept(); else await dialog.dismiss(); });
  await page.evaluate(() => { history.back(); });
  await expect.poll(() => warnings).toBe(1);
  await expect(page).toHaveURL(/\/journal\?tab=accounts$/);
  await expect(details.getByRole('img', { name: 'Unsaved screenshot 1', exact: true })).toBeVisible();
  leave = true;
  await page.evaluate(() => { history.back(); });
  await expect(page).toHaveURL(/\/account$/);
  expect(warnings).toBe(2);
});

test('pasting in Edit autosaves to this trade, keeps text paste intact, and survives Cancel and reload', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request, 'Original notes');
  const other = await createTrade(page.request, 'Another trade');
  const details = await openEditor(page, trade);
  const notes = details.getByLabel('Notes', { exact: true });
  const plainPastePrevented = await notes.evaluate(element => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'A text note');
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(plainPastePrevented).toBe(false);
  await notes.fill('Unsaved changed notes');
  expect(await pasteImage(page, trade, await png())).toBe(true);
  await expect(details.getByText('Saved', { exact: true })).toBeVisible();
  await expect.poll(async () => (await list(page.request, trade)).length).toBe(1);
  expect(await list(page.request, other)).toHaveLength(0);
  await details.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(details.getByText('Original notes', { exact: true })).toBeVisible();
  await expect(details.getByRole('img', { name: 'Trade screenshot 1', exact: true })).toBeVisible();
  await expect(details.locator('input[type="file"]')).toHaveCount(0);
  await page.reload();
  await page.locator(`[aria-controls="trade-details-${trade}"]`).click();
  const image = page.locator(`#trade-details-${trade}`).getByRole('img', { name: 'Trade screenshot 1', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(640);
});

test('failed uploads retry with the same operation and the file picker remains usable on mobile', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  await page.setViewportSize({ width: 390, height: 900 });
  const details = await openEditor(page, trade);
  let attempts = 0;
  const operations: string[] = [];
  await page.route(`**${endpoint(trade)}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts++;
    const body = route.request().postData() || '';
    const operation = body.match(/name="clientUploadId"\r?\n\r?\n([^\r\n]+)/)?.[1];
    if (operation) operations.push(operation);
    if (attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Screenshot storage is temporarily unavailable' }) });
    return route.continue();
  });
  await details.locator('input[type="file"]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: await png() });
  await expect(details.getByRole('button', { name: /Retry/ })).toBeVisible();
  expect(await list(page.request, trade)).toHaveLength(0);
  await details.getByRole('button', { name: /Retry/ }).click();
  await expect(details.getByText('Saved', { exact: true })).toBeVisible();
  expect(operations).toHaveLength(2);
  expect(operations[0]).toBe(operations[1]);
  expect(await list(page.request, trade)).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include(`#trade-details-${trade} .trade-screenshot-section`).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
});

test('rapid pasted images stop at three and an extra paste reports the limit', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  const details = await openEditor(page, trade);
  const image = await png();
  await pasteImage(page, trade, image);
  await pasteImage(page, trade, image);
  await pasteImage(page, trade, image);
  await expect.poll(async () => (await list(page.request, trade)).length).toBe(3);
  await pasteImage(page, trade, image);
  await expect(details.getByRole('alert')).toContainText(/three screenshots|3 screenshots/i);
  expect(await list(page.request, trade)).toHaveLength(3);
  await details.getByRole('button', { name: /Remove screenshot 1/ }).click();
  await expect.poll(async () => (await list(page.request, trade)).length).toBe(2);
});

test('a lost successful upload response reconciles without a duplicate or failed preview', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request);
  const details = await openEditor(page, trade);
  let uploads = 0;
  await page.route(`**${endpoint(trade)}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    uploads++;
    const stored = await route.fetch();
    expect(stored.status()).toBe(201);
    return route.abort('failed');
  });
  await pasteImage(page, trade, await png());
  await expect(details.getByText('Saved', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: /Retry|Remove preview/ })).toHaveCount(0);
  expect(uploads).toBe(1);
  expect(await list(page.request, trade)).toHaveLength(1);
});

test('pending uploads guard Cancel and switching trades, and stay bound to the original trade', async ({ page }) => {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const trade = await createTrade(page.request, 'Pending upload owner');
  const other = await createTrade(page.request, 'Different trade');
  const details = await openEditor(page, trade);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reached = resolve; });
  await page.route(`**${endpoint(trade)}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    reached(); await gate; await route.continue();
  });
  try {
    await pasteImage(page, trade, await png());
    await started;
    const messages: string[] = [];
    page.on('dialog', async dialog => { messages.push(dialog.message()); await dialog.dismiss(); });
    await details.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(details.getByLabel('Notes', { exact: true })).toBeVisible();
    await page.locator(`[aria-controls="trade-details-${other}"]`).click();
    await expect(details.getByLabel('Notes', { exact: true })).toBeVisible();
    expect(messages).toHaveLength(2);
    expect(messages.every(message => message.includes('still saving'))).toBe(true);
  } finally { release(); }
  await expect(details.getByText('Saved', { exact: true })).toBeVisible();
  expect(await list(page.request, trade)).toHaveLength(1);
  expect(await list(page.request, other)).toHaveLength(0);
});

for (const channel of ['chromium', 'msedge'] as const) {
  test(`Windows native clipboard screenshot saves with Control+V in ${channel}`, async () => {
    test.skip(process.platform !== 'win32', 'The native clipboard helper requires Windows.');
    // Headless Chromium uses an internal clipboard. A windowed browser is needed
    // to exercise Windows clipboard formats and the native Control+V path.
    const launched = await chromium.launch({ ...(channel === 'msedge' ? { channel: 'msedge' } : {}), headless: false, args: ['--window-position=-16000,-16000'] });
    const context = await launched.newContext({ baseURL: origin, viewport: { width: 1280, height: 960 } });
    const page = await context.newPage();
    try {
      const owner = await createOwner(); users.push(owner.id);
      await login(page, owner.email);
      const trade = await createTrade(page.request, 'Native clipboard screenshot');
      const details = await openEditor(page, trade);
      const image = await details.screenshot({ animations: 'disabled' });
      await details.getByLabel('Notes', { exact: true }).focus();
      await withNativeClipboard(image, async () => {
        await page.keyboard.press('Control+V');
        await expect(details.getByText('Saved', { exact: true })).toBeVisible();
        expect(await list(page.request, trade)).toHaveLength(1);
      });
      await page.reload();
      await page.locator(`[aria-controls="trade-details-${trade}"]`).click();
      await expect(page.locator(`#trade-details-${trade}`).getByRole('img', { name: 'Trade screenshot 1', exact: true })).toBeVisible();
    } finally { await context.close(); await launched.close(); }
  });
}
