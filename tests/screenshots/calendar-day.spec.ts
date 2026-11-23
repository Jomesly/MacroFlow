import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { admin, assertLocal, createOwner, createTrade, list, login, upload } from './helpers';

const shots = '.artifacts/screenshot-eval/calendar-day';
let users: string[] = [];
test.beforeAll(async ({ request }) => { await assertLocal(request); mkdirSync(shots, { recursive: true }); });
test.afterEach(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  users = [];
});

const chart = (background: string) => sharp({ create: { width: 1280, height: 720, channels: 3, background } }).png().toBuffer();

async function seedDay(page: Page) {
  const owner = await createOwner(); users.push(owner.id);
  await login(page, owner.email);
  const withShots = await createTrade(page.request, 'Swept the Asian low, entered on the retest');
  const without = await createTrade(page.request, 'No chart saved');
  for (const color of ['#1e3b2f', '#831613']) expect((await upload(page.request, withShots, await chart(color))).status()).toBe(201);
  expect(await list(page.request, withShots)).toHaveLength(2);
  return { withShots, without };
}

async function openDay(page: Page) {
  await page.goto('/journal?tab=analytics');
  const day = page.getByRole('button', { name: /Show trades and screenshots/ });
  await expect(day).toHaveCount(1);
  await expect(day).toContainText('2'); // camera badge
  await day.click();
  const drawer = page.getByRole('dialog', { name: /\d{4}/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('status', { name: 'Loading trades' })).toHaveCount(0);
  return { day, drawer };
}

const loaded = (page: Page, selector: string) => page.locator(selector).evaluateAll(
  (images) => images.length > 0 && images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0));

test('a calendar day opens its trades and their saved screenshots, with a full-size viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await seedDay(page);
  const { day, drawer } = await openDay(page);

  const trades = drawer.locator('.jd-day-trade');
  await expect(trades).toHaveCount(2);
  const thumbs = drawer.getByRole('button', { name: /View XAUUSD screenshot \d of 2/ });
  await expect(thumbs).toHaveCount(2);
  await expect(drawer.getByText('No screenshots', { exact: true })).toHaveCount(1);
  await expect.poll(() => loaded(page, '.jd-day-thumb img')).toBe(true);
  await page.screenshot({ path: `${shots}/desktop-drawer.png`, animations: 'disabled' });

  const accessibility = await new AxeBuilder({ page }).include('.jd-day-drawer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);

  // Full-size viewer: arrows move across the day's images; Escape closes only the viewer.
  await thumbs.first().click();
  const viewer = page.getByRole('dialog', { name: /XAUUSD Long · screenshot 1 of 2/ });
  await expect(viewer).toBeVisible();
  await expect.poll(() => loaded(page, '.jd-lightbox-stage img')).toBe(true);
  await page.screenshot({ path: `${shots}/desktop-lightbox.png`, animations: 'disabled' });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: /screenshot 2 of 2/ })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: /screenshot 1 of 2/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.jd-lightbox')).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(thumbs.first()).toBeFocused();

  // Escape closes the drawer and returns focus to the day that opened it.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(day).toBeFocused();
  expect(consoleErrors).toEqual([]);
});

test('"Add screenshots in History" opens that trade ready for pasting', async ({ page }) => {
  const { without } = await seedDay(page);
  const { drawer } = await openDay(page);
  await drawer.getByRole('button', { name: 'Add screenshots in History', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  const details = page.locator(`#trade-details-${without}`);
  await expect(details.getByRole('group', { name: 'Paste a screenshot' })).toBeVisible();
  await expect(page.locator(`#edit-notes-${without}`)).toHaveValue('No chart saved');
});

test('screenshots never leak across accounts through the day view', async ({ page, browser }) => {
  await seedDay(page);
  const intruderPage = await browser.newPage();
  const intruder = await createOwner(); users.push(intruder.id);
  await login(intruderPage, intruder.email);
  const today = new Date().toISOString().slice(0, 10);
  const response = await intruderPage.request.get(`/api/journal/day?date=${today}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).trades).toEqual([]);
  await intruderPage.close();
});

test('on a phone the day opens as a bottom sheet without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDay(page);
  const { drawer } = await openDay(page);
  await expect.poll(() => loaded(page, '.jd-day-thumb img')).toBe(true);
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.y + box!.height)).toBe(844);
  expect(Math.round(box!.width)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `${shots}/mobile-sheet.png`, animations: 'disabled' });
  await drawer.getByRole('button', { name: /View XAUUSD screenshot 1 of 2/ }).click();
  await expect.poll(() => loaded(page, '.jd-lightbox-stage img')).toBe(true);
  // The full-size viewer fits the phone: image inside the screen, close button reachable.
  const fits = (selector: string) => page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth + 0.5;
  });
  expect(await fits('.jd-lightbox')).toBe(true);
  expect(await fits('.jd-lightbox-stage img')).toBe(true);
  const close = page.getByRole('button', { name: 'Close screenshot', exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${shots}/mobile-lightbox.png`, animations: 'disabled' });
  await close.click();
  await expect(page.locator('.jd-lightbox')).toHaveCount(0);
});
