import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { BiasApiResponse, BiasResult } from '../../src/lib/types';

// Synthetic market fixtures keep visual checks deterministic and independent of providers.
const now = '2026-10-31T12:00:00.000Z';
const assets: [
  BiasResult['symbol'],
  string,
  number,
  BiasResult['direction'],
][] = [
  ['XAUUSD', 'Gold', 42, 'bullish'],
  ['GBPUSD', 'British Pound / US Dollar', -28, 'weakly_bearish'],
  ['US100', 'Nasdaq 100', 65, 'bullish'],
  ['DJ30', 'Dow Jones 30', 0, 'neutral'],
  ['BTCUSD', 'Bitcoin', -55, 'bearish'],
];
const fixture: BiasApiResponse = {
  timestamp: now,
  source: 'live',
  disclaimer: 'Test fixture',
  sourceHealth: { fred: 'ok', finnhub: 'ok', rss: 'empty', market_data: 'ok' },
  dxy: {
    price: '103.42',
    percentChange: -0.18,
    status: 'weakening',
    summary: 'A softer dollar provides context for dollar-denominated markets.',
  },
  nextEvent: {
    name: 'US employment report',
    country: 'US',
    date: '2026-11-06T13:30:00Z',
    impact: 'high',
    affects: ['XAUUSD', 'GBPUSD', 'US100'],
  },
  data: assets.map(([symbol, name, score, direction], i) => ({
    symbol,
    name,
    biasScore: score,
    biasPercent: score,
    direction,
    strength: 'moderate',
    conviction: i % 2 === 0 ? 'high' : 'medium',
    signal: score > 0 ? 'buy' : score < 0 ? 'sell' : 'neutral',
    dailyLabel: direction.replaceAll('_', ' '),
    drivers: ['Macro context'],
    confirmationRatio: 64 + i * 3,
    eventCount: 9 + i,
    confidenceCount: 7,
    totalPossibleSignals: 12,
    lastUpdated: now,
    history: [12, 20, 8, 25, 17, 31, score].map((biasScore, day) => ({
      date: `2026-10-${24 + day}`,
      biasScore: score < 0 ? -Math.abs(biasScore) : biasScore,
      direction,
    })),
    events: [
      {
        id: `event-${i}`,
        title: [
          'Federal Reserve policy outlook in focus',
          'Dollar softens as markets assess economic data',
          'US earnings shape the equity outlook',
          'Markets weigh growth and inflation',
          'Digital asset markets react to macro conditions',
        ][i],
        description: 'Deterministic browser-test event. No live market claim.',
        category: 'fed_tone',
        impact: 'high',
        scoreChange: score,
        sourceName: 'Test market feed',
      },
    ],
  })),
};
const artifactDir = path.resolve('.artifacts/ui-review');
mkdirSync(artifactDir, { recursive: true });

const contextMeta = {
  provider: 'Fixture source', instrumentId: 'fixture', sourceUrl: 'https://example.com',
  observedAt: '2026-11-05T00:00:00.000Z', fetchedAt: new Date().toISOString(),
  freshUntil: new Date(Date.now() + 3_600_000).toISOString(),
  staleUntil: new Date(Date.now() + 86_400_000).toISOString(), status: 'fresh', delayed: true,
};
const calendarFixture = {
  meta: { ...contextMeta, observedAt: null, delayed: false },
  data: {
    windowStart: '2026-11-08T00:00:00.000Z', windowEnd: '2026-11-14T23:00:00.000Z',
    events: [
      { id: 'cpi', title: 'US CPI fixture', currency: 'USD', date: '2026-11-10T13:30:00.000Z', impact: 'high', forecast: '2.4%', previous: '2.5%', actual: null, affects: ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'] },
      { id: 'gdp', title: 'UK GDP fixture', currency: 'GBP', date: '2026-11-11T07:00:00.000Z', impact: 'medium', forecast: null, previous: '0.1%', actual: null, affects: ['GBPUSD'] },
    ],
  },
};
const macroFixture = Object.fromEntries([
  ['dxy', 103.42, 'index'], ['treasury2y', 4.46, 'percent'], ['treasury10y', 4.84, 'percent'],
  ['spread', 38, 'basis-points'], ['vix', 28.18, 'index'],
].map(([key, value, unit]) => [key, { meta: contextMeta, data: { value, unit } }]));

test.beforeEach(async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'View XAUUSD analysis' })).toBeVisible();
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
  await page.route('**/api/bias', (route) =>
    route.fulfill({ status, json: body }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'MacroFlow', exact: true }),
  ).toBeVisible();
  if (status === 200)
    await expect(
      page.getByRole('button', { name: 'View XAUUSD analysis' }),
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
  await page.getByRole('button', { name: 'Bullish', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Neutral', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'DJ30' })).toBeVisible();
  await page.getByRole('button', { name: 'All markets' }).click();
  await expect(page.locator('.market-card')).toHaveCount(5);
  const history = page
    .locator('.market-card')
    .first()
    .getByRole('button', { name: '7-day history' });
  await history.click();
  await expect(history).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('table', { name: 'Daily bias history for XAUUSD' }),
  ).toBeVisible();
  await page.getByText('Data sources', { exact: true }).click();
  await expect(
    page.getByText('Connected', { exact: true }).first(),
  ).toBeVisible();
  const card = page.getByRole('button', { name: 'View XAUUSD analysis' });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'XAUUSD' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close market analysis' }),
  ).toBeFocused();
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
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('card surfaces distinguish bullish, bearish and neutral markets and update with the feed', async ({
  page,
}) => {
  await prepare(page);
  const surface = (symbol: string) =>
    page.locator('.market-card').filter({
      has: page.getByRole('heading', { name: symbol, exact: true }),
    });
  const channels = async (symbol: string) =>
    surface(symbol).evaluate((el) =>
      getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number),
    );
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
  await page.getByRole('button', { name: 'View XAUUSD analysis' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertFits(page);
  expect(
    await page
      .locator('dialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
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
  await page.keyboard.press('Escape');
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
