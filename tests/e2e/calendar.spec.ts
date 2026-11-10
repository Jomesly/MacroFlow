import { expect, test, type Page } from '@playwright/test';

const baseURL = process.env.CALENDAR_TEST_URL ?? 'http://localhost:3137';
const panel = (page: Page) => page.locator('section[aria-labelledby="calendar-heading"]');
function fixture(archiveStatus: 'ok' | 'failed' = 'ok') {
  return { events: [{ id: 'test-cpi', title: 'CPI m/m', currency: 'USD', time: new Date().toISOString(), impact: 'high', forecast: '0.3%', previous: '0.2%', actual: null, affects: ['XAUUSD'] }], fetchedAt: new Date().toISOString(), source: 'test fixture', archiveStatus };
}

test.beforeEach(async ({ page }) => {
  // Keep the calendar regression independent of upstream market providers.
  await page.route('**/api/bias', route => route.fulfill({ json: { data: [], timestamp: new Date().toISOString(), source: 'baseline', disclaimer: '' } }));
});

test('filters work when both browser storage reads and writes are blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  await page.route('**/api/calendar', route => route.fulfill({ json: fixture() }));
  await page.goto(baseURL);
  await expect(panel(page).getByRole('table')).toBeVisible();
  const week = panel(page).getByRole('button', { name: 'This week', exact: true });
  await week.click();
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  const high = panel(page).getByRole('button').filter({ has: page.getByRole('img', { name: 'High impact', exact: true }) });
  await high.click();
  await expect(high).toHaveAttribute('aria-pressed', 'false');
  await expect(panel(page).getByText('No events match these filters this week.')).toBeVisible();
  await high.click();
  const usd = panel(page).getByRole('button', { name: 'USD', exact: true });
  await usd.click();
  await expect(usd).toHaveAttribute('aria-pressed', 'false');
});

test('retains events with a stale warning on refresh failure and recovers through Retry', async ({ page }) => {
  let fail = false;
  await page.clock.install();
  await page.route('**/api/calendar', route => fail
    ? route.fulfill({ status: 503, json: { error: 'Calendar unavailable' } })
    : route.fulfill({ json: fixture() }));
  await page.goto(baseURL);
  await expect(panel(page).getByRole('table')).toBeVisible();
  fail = true;
  await page.clock.fastForward(15 * 60_000);
  await expect(panel(page).getByRole('alert')).toContainText('Calendar refresh failed');
  await expect(panel(page).getByRole('alert')).toContainText('Last successful refresh');
  await expect(panel(page).getByRole('table')).toBeVisible();
  fail = false;
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  await expect(panel(page).getByRole('table')).toBeVisible();
});

test('shows an archive outage while retaining calendar display and recovers on retry', async ({ page }) => {
  let status: 'ok' | 'failed' = 'failed';
  await page.route('**/api/calendar', route => route.fulfill({ json: fixture(status) }));
  await page.goto(baseURL);
  await expect(panel(page).getByRole('table')).toBeVisible();
  await expect(panel(page).getByRole('alert')).toContainText('Forecast archive unavailable');
  status = 'ok';
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
});

test('normal filters persist and the calendar fits desktop and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/calendar', route => route.fulfill({ json: fixture() }));
  await page.goto(baseURL);
  await expect(panel(page).getByRole('table')).toBeVisible();
  await panel(page).getByRole('button', { name: 'This week', exact: true }).click();
  await page.reload();
  await expect(panel(page).getByRole('button', { name: 'This week', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('initial failure offers Retry and malformed refresh data keeps saved events marked stale', async ({ page }) => {
  let response: 'failed' | 'ok' | 'malformed' = 'failed';
  await page.clock.install();
  await page.route('**/api/calendar', route => response === 'failed'
    ? route.fulfill({ status: 503, json: { error: 'Calendar unavailable' } })
    : route.fulfill({ json: response === 'ok' ? fixture() : { events: null } }));
  await page.goto(baseURL);
  await expect(panel(page).getByRole('alert')).toContainText('Calendar unavailable');
  response = 'ok';
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page).getByRole('table')).toBeVisible();
  response = 'malformed';
  await page.clock.fastForward(15 * 60_000);
  await expect(panel(page).getByRole('alert')).toContainText('Calendar refresh failed');
  await expect(panel(page).getByRole('table')).toBeVisible();
});

test('a stalled request times out and can be retried', async ({ page }) => {
  await page.clock.install();
  let stalled = true;
  await page.route('**/api/calendar', async route => {
    if (!stalled) await route.fulfill({ json: fixture() });
  });
  await page.goto(baseURL);
  await expect(panel(page).getByLabel('Loading calendar')).toBeVisible();
  await page.clock.fastForward(20_001);
  await expect(panel(page).getByRole('alert')).toContainText('Calendar unavailable');
  stalled = false;
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page).getByRole('table')).toBeVisible();
});
