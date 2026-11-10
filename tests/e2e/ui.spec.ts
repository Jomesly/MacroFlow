import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fixture, calendarFixture, macroFixture, contextMeta } from './fixtures/market';
import { readColor } from './helpers/colors';

const artifactDir = path.resolve('.artifacts/ui-review');
mkdirSync(artifactDir, { recursive: true });


test.beforeEach(async ({ page }) => {
  await page.route('**/api/calendar/consensus', route => route.fulfill({ json: { events: [], fetchedAt: new Date().toISOString(), archiveStatus: 'ok' } }));
  await page.route('**/api/calendar', (route) => route.fulfill({ json: calendarFixture }));
  await page.route('**/api/macro-context', (route) => route.fulfill({ json: macroFixture }));
});

test('calendar filters, source dates and independent panel recovery work', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await prepare(page);
  const calendar = page.getByRole('region', { name: 'Economic calendar', exact: true });
  await expect(calendar.getByText('USD · US CPI fixture', { exact: true })).toBeVisible();
  await calendar.getByLabel('Currency', { exact: true }).selectOption('GBP');
  await expect(calendar.getByText('GBP · UK GDP fixture', { exact: true })).toBeVisible();
  await expect(calendar.getByText('USD · US CPI fixture', { exact: true })).toHaveCount(0);
  await calendar.getByLabel('Impact', { exact: true }).selectOption('high');
  await expect(calendar.getByText('No releases match these filters in the available schedule.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Macro context', exact: true }).getByText('4.46%', { exact: true })).toBeVisible();
  await expect(page.getByText('Observation 2026-11-05', { exact: false }).first()).toBeVisible();
  await assertFits(page);
  await page.route('**/api/calendar', (route) => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await calendar.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(calendar.getByRole('alert')).toContainText('Calendar refresh failed');
  await expect(page.getByRole('link', { name: 'View XAUUSD analysis' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Macro context', exact: true }).getByText('4.46%', { exact: true })).toBeVisible();
});

test('stale calendar and partial macro data are labelled without hiding healthy readings', async ({ page }) => {
  await page.route('**/api/calendar', (route) => route.fulfill({ json: { ...calendarFixture, meta: { ...calendarFixture.meta, status: 'stale' } } }));
  await page.route('**/api/macro-context', (route) => route.fulfill({ json: { ...macroFixture, treasury10y: { data: null, meta: { ...contextMeta, status: 'unavailable' } } } }));
  await prepare(page);
  await expect(page.getByText('Showing the last-known schedule while the source is unavailable.')).toBeVisible();
  const context = page.getByRole('region', { name: 'Macro context', exact: true });
  await expect(context.getByText('4.46%', { exact: true })).toBeVisible();
  await expect(context.getByText('Unavailable', { exact: true })).toBeVisible();
});

async function prepare(page: Page, body = fixture, status = 200) {
  await page.route('**/api/bias*', (route) => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol');
    return route.fulfill({ status, json: { ...body, data: symbol ? body.data.filter((entry) => entry.symbol === symbol) : body.data } });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'MacroFlow', exact: true }),
  ).toBeVisible();
  if (status === 200)
    await expect(
      page.getByRole('link', { name: 'View XAUUSD analysis' }),
    ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh', exact: true }),
  ).toBeEnabled();
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

async function assertFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const [label, width, height] of [
  ['desktop', 1440, 1100],
  ['tablet', 768, 1024],
  ['mobile', 375, 812],
] as const) {
  test(`dashboard ${label}: fits viewport and passes automated accessibility checks`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await prepare(page);
    await assertFits(page);
    await expect(page.locator('.market-card')).toHaveCount(5);
    await expect(
      page.getByRole('img', { name: '2 bullish, 1 neutral, 2 bearish' }),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: path.join(artifactDir, `dashboard-${label}.png`),
      fullPage: true,
      animations: 'disabled', style: 'nextjs-portal { display: none !important; }',
    });
  });
}

test('filters, history, source status and keyboard-accessible market analysis work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await prepare(page);
  expect(await page.locator('.market-card h3').allTextContents()).toEqual([
    'US100',
    'BTCUSD',
    'XAUUSD',
    'GBPUSD',
    'DJ30',
  ]);
  await page.getByRole('button', { name: 'Bullish', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Neutral', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'DJ30' })).toBeVisible();
  await page.getByRole('button', { name: 'All markets' }).click();
  await expect(page.locator('.market-card')).toHaveCount(5);
  await page.getByText('Data sources', { exact: true }).click();
  await expect(
    page.getByText('Connected', { exact: true }).first(),
  ).toBeVisible();
  const card = page.getByRole('link', { name: 'View XAUUSD analysis' });
  await expect(card).toHaveAttribute('href', '/markets/XAUUSD');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/markets/XAUUSD');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('table', { name: 'Daily bias history for XAUUSD' }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})));
  });
  await page.screenshot({
    path: path.join(artifactDir, 'market-analysis-desktop.png'),
    fullPage: true,
    animations: 'disabled', style: 'nextjs-portal { display: none !important; }',
  });
  await page.goBack();
  await expect(card).toBeVisible();
});

test('card surfaces distinguish bullish, bearish and neutral markets and update with the feed', async ({
  page,
}) => {
  await prepare(page);
  const surface = (symbol: string) =>
    page.locator('.market-card').filter({
      has: page.getByRole('heading', { name: symbol, exact: true }),
    });
  const channels = (symbol: string) => readColor(surface(symbol));
  for (const symbol of ['XAUUSD', 'US100']) {
    const [r, g] = await channels(symbol);
    expect(g).toBeGreaterThan(r);
    await expect(surface(symbol).locator('.market-direction')).toHaveText(
      'Bullish',
    );
  }
  for (const symbol of ['GBPUSD', 'BTCUSD']) {
    const [r, g] = await channels(symbol);
    expect(r).toBeGreaterThan(g);
    await expect(surface(symbol).locator('.market-direction')).toContainText(
      /bearish/i,
    );
  }
  const [r, g, b] = await channels('DJ30');
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10);
  await expect(surface('DJ30').locator('.market-direction')).toHaveText(
    'Neutral',
  );

  await page.unroute('**/api/bias');
  await page.route('**/api/bias', (route) =>
    route.fulfill({
      json: {
        ...fixture,
        data: fixture.data.map((item) =>
          item.symbol === 'XAUUSD'
            ? {
                ...item,
                direction: 'weakly_bearish',
                biasScore: -18,
                biasPercent: -18,
              }
            : item,
        ),
      },
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(surface('XAUUSD').locator('.market-direction')).toHaveText(
    'Leaning bearish',
  );
  await expect
    .poll(async () => {
      const [newR, newG] = await channels('XAUUSD');
      return newR > newG;
    })
    .toBe(true);
  await expect(surface('XAUUSD')).toContainText('Bias changed from bullish');
});

test('mobile market analysis and enlarged text remain readable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await prepare(page);
  await page.getByRole('link', { name: 'View XAUUSD analysis' }).click();
  await expect(page).toHaveURL('/markets/XAUUSD');
  await expect(page.getByRole('region', { name: 'Current market bias' })).toBeVisible();
  await assertFits(page);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: path.join(artifactDir, 'market-analysis-mobile.png'),
    fullPage: true,
    animations: 'disabled', style: 'nextjs-portal { display: none !important; }',
  });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await assertFits(page);
});

test('reduced motion stops decorative animation and preserves interactions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === 'running')
            .length,
      ),
    )
    .toBe(0);
  expect(
    await page
      .locator('.chart-line')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.getByRole('button', { name: 'Bearish', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('unavailable providers show an honest error and a working retry', async ({
  page,
}) => {
  await prepare(page, fixture, 503);
  await expect(page.locator('.notice[role="alert"]')).toContainText(
    'Market data could not be loaded',
  );
  await page.unroute('**/api/bias');
  await page.route('**/api/bias', (route) => route.fulfill({ json: fixture }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(5);
});

for (const width of [375, 1440]) {
  test(`account screens at ${width}px retain labels and readable contrast`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.goto('/login');
    await expect(
      page.getByRole('heading', { name: 'Sign in to your journal' }),
    ).toBeVisible();
    await assertFits(page);
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})));
    });
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: path.join(artifactDir, `login-${width}.png`),
      fullPage: true,
      animations: 'disabled', style: 'nextjs-portal { display: none !important; }',
    });
    await page.goto('/signup');
    await assertFits(page);
    await expect(
      page.getByLabel('Confirm password', { exact: true }),
    ).toBeVisible();
    // Assess final text colors after the account panel's entrance animation.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})));
    });
    const signupAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(signupAudit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    }))).toEqual([]);
    await page.screenshot({
      path: path.join(artifactDir, `signup-${width}.png`),
      fullPage: true,
      animations: 'disabled', style: 'nextjs-portal { display: none !important; }',
    });
  });
}
