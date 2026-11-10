import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixture, calendarFixture, macroFixture } from './fixtures/market';
import type { BiasApiResponse, BiasResult } from '../../src/lib/types';
import { mkdirSync } from 'node:fs';
import { contrast, readColor } from './helpers/colors';

const artifacts = '.artifacts/market-detail';
mkdirSync(artifacts, { recursive: true });
const market = fixture.data[0];
const opposing = { ...market.events[0], id: 'opposing', title: 'Opposing evidence fixture', scoreChange: -12, url: 'https://example.com/evidence' };
const detailFixture: BiasApiResponse = { ...fixture, data: fixture.data.map((entry) => ({ ...entry, events: [...entry.events, opposing] })) };

async function mockBias(page: Page, body = detailFixture, status = 200) {
  await page.route('**/api/bias*', (route) => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol');
    return route.fulfill({ status, json: { ...body, data: symbol ? body.data.filter((entry) => entry.symbol === symbol) : body.data } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T06:00:00Z'));
  await page.route('**/api/calendar', (route) => route.fulfill({ json: calendarFixture }));
  await page.route('**/api/macro-context', (route) => route.fulfill({ json: macroFixture }));
  await mockBias(page);
});

for (const width of [1440, 375]) {
  test(`conviction changes fill intensity without dimming content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let conviction: BiasResult['conviction'] = 'low';
    await page.route('**/api/bias*', (route) => {
      const symbol = new URL(route.request().url()).searchParams.get('symbol');
      return route.fulfill({ json: { ...detailFixture, data: detailFixture.data.filter((entry) => !symbol || entry.symbol === symbol).map((entry) => ({ ...entry, conviction })) } });
    });
    const paints: Record<string, Record<string, number[]>> = {};
    for (const level of ['low', 'medium', 'high'] as const) {
      conviction = level;
      await page.goto('/');
      await expect(page.locator('.market-card')).toHaveCount(5);
      await page.mouse.move(0, 0);
      paints[level] = {};
      for (const symbol of ['XAUUSD', 'BTCUSD', 'DJ30']) {
        const row = page.locator('.market-card').filter({ has: page.getByRole('heading', { name: symbol, exact: true }) });
        await expect(row).toHaveAttribute('data-conviction', level);
        paints[level][symbol] = await readColor(row);
        expect(contrast(await readColor(row.locator('.market-score'), 'color'), paints[level][symbol])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(await readColor(row.locator('.market-conviction'), 'color'), paints[level][symbol])).toBeGreaterThanOrEqual(4.5);
        await row.getByRole('link', { name: `View ${symbol} analysis` }).focus();
        expect(contrast(await readColor(row.locator('.market-score'), 'color'), await readColor(row))).toBeGreaterThanOrEqual(4.5);
        paints[`${level}-interactive`] ??= {};
        paints[`${level}-interactive`][symbol] = await readColor(row);
        await expect(row.getByRole('link', { name: `View ${symbol} analysis` })).toHaveCSS('outline-style', 'solid');
      }
      // Remove keyboard focus so the hover/normal comparisons are independent.
      await page.getByRole('button', { name: 'Refresh', exact: true }).focus();
      await page.locator('.market-grid').screenshot({ path: `${artifacts}/conviction-${level}-${width}-ladder.png`, animations: 'disabled' });
      if (level === 'low') {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(result.violations.map((violation) => violation.id)).toEqual([]);
      }
      for (const symbol of ['XAUUSD', 'BTCUSD', 'DJ30']) {
        await page.goto(`/markets/${symbol}`);
        await expect(page.locator('.market-research')).toHaveAttribute('data-conviction', level);
        const hero = page.locator('.research-hero');
        expect(await readColor(hero)).toEqual(paints[level][symbol]);
        expect(contrast(await readColor(page.locator('.research-bias strong'), 'color'), await readColor(hero))).toBeGreaterThanOrEqual(4.5);
        if (symbol !== 'DJ30') await hero.screenshot({ path: `${artifacts}/conviction-${level}-${width}-${symbol}.png`, animations: 'disabled' });
        if (level === 'low' && symbol !== 'DJ30') {
          const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          expect(result.violations.map((violation) => violation.id)).toEqual([]);
        }
      }
    }
    const neutral = paints.high.DJ30;
    const distance = (color: number[]) => color.reduce((sum, channel, index) => sum + Math.abs(channel - neutral[index]), 0);
    for (const symbol of ['XAUUSD', 'BTCUSD']) {
      expect(distance(paints.low[symbol]), JSON.stringify(paints)).toBeLessThan(distance(paints.medium[symbol]));
      expect(distance(paints.medium[symbol])).toBeLessThan(distance(paints.high[symbol]));
    }
    expect(paints.high.XAUUSD).toEqual([30, 59, 47]);
    expect(paints.high.BTCUSD).toEqual([131, 22, 19]);
    expect(paints.low.DJ30).toEqual(neutral);
    expect(paints.medium.DJ30).toEqual(neutral);
    const interactiveNeutral = paints['high-interactive'].DJ30;
    const interactiveDistance = (color: number[]) => color.reduce((sum, channel, index) => sum + Math.abs(channel - interactiveNeutral[index]), 0);
    for (const symbol of ['XAUUSD', 'BTCUSD']) {
      expect(interactiveDistance(paints['low-interactive'][symbol])).toBeLessThan(interactiveDistance(paints['medium-interactive'][symbol]));
      expect(interactiveDistance(paints['medium-interactive'][symbol])).toBeLessThan(interactiveDistance(paints['high-interactive'][symbol]));
    }
  });
}

test('refresh changes conviction colors while the score and direction stay the same', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let conviction: BiasResult['conviction'] = 'low';
  await page.route('**/api/bias*', (route) => route.fulfill({
    json: { ...detailFixture, data: detailFixture.data.map((entry) => ({ ...entry, conviction })) },
  }));
  for (const url of ['/', '/markets/XAUUSD']) {
    conviction = 'low';
    await page.goto(url);
    const dashboard = url === '/';
    const surface = dashboard
      ? page.locator('.market-card').filter({ has: page.getByRole('heading', { name: 'XAUUSD', exact: true }) })
      : page.locator('.market-research');
    const fill = dashboard ? surface : page.locator('.research-hero');
    await expect(surface).toHaveAttribute('data-conviction', 'low');
    const lowColor = await readColor(fill);
    const score = dashboard ? surface.locator('.market-score') : page.locator('.research-bias strong');
    const scoreText = await score.textContent();
    conviction = 'high';
    await page.getByRole('button', { name: dashboard ? 'Refresh' : 'Refresh analysis', exact: true }).click();
    await expect(surface).toHaveAttribute('data-conviction', 'high');
    expect(await readColor(fill)).toEqual([30, 59, 47]);
    await expect(score).toHaveText(scoreText!);
    conviction = 'low';
    await page.getByRole('button', { name: dashboard ? 'Refresh' : 'Refresh analysis', exact: true }).click();
    await expect(surface).toHaveAttribute('data-conviction', 'low');
    expect(await readColor(fill)).toEqual(lowColor);
  }
});

for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['phone', 375, 812]] as const) {
  test(`market analysis ${label}: readable evidence, history and accessible controls`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/markets/XAUUSD');
    await expect(page.getByRole('region', { name: 'Current market bias' })).toContainText('+42%');
    await expect(page.getByRole('heading', { name: 'Supporting drivers (1)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Opposing drivers (1)' })).toBeVisible();
    const evidence = page.locator('.research-drivers summary').first();
    await evidence.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Deterministic browser-test event. No live market claim.').first()).toBeVisible();
    const history = page.getByRole('table', { name: 'Daily bias history for XAUUSD' });
    await expect(history.getByRole('row')).toHaveCount(8);
    const calendar = page.getByRole('region', { name: 'Economic calendar', exact: true });
    await expect(calendar.getByText('Next release: US CPI fixture')).toBeVisible();
    await expect(calendar.getByText('GBP · UK GDP fixture', { exact: true })).toHaveCount(0);
    await expect(page.getByText('4.46%', { exact: true })).toBeVisible();
    await page.getByText('Score breakdown and methodology', { exact: true }).click();
    await expect(page.getByText('42 / [-100, +100]', { exact: false })).toBeVisible();
    // Scan from the top so no control sits under the sticky header by scroll position alone.
    await page.evaluate(() => window.scrollTo(0, 0));
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${artifacts}/${label}.png`, fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
    if (label === 'phone') {
      await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test('a market card opens the full analysis directly and returning restores the dashboard filter and scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Bullish', exact: true }).click();
  const row = page.getByRole('link', { name: 'View XAUUSD analysis' });
  await expect(row).toHaveAttribute('href', '/markets/XAUUSD');
  await row.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  await row.click();
  await expect(page).toHaveURL('/markets/XAUUSD');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Current market bias' })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.getByRole('link', { name: 'Back to markets', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Bullish', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.market-card')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, -1);
});

test('all five symbols support switching, direct refresh and browser back', async ({ page }) => {
  await page.goto('/markets/XAUUSD');
  const nav = page.getByRole('navigation', { name: 'Choose a market' });
  for (const symbol of ['GBPUSD', 'US100', 'DJ30', 'BTCUSD']) {
    await nav.getByRole('link', { name: symbol, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: symbol, exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Current market bias' })).toBeVisible();
    await expect(nav.getByRole('link', { name: symbol, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(`${symbol} analysis | MacroFlow`);
  }
  await page.reload();
  await expect(page.getByRole('region', { name: 'Current market bias' })).toContainText('Market open');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'DJ30', exact: true })).toBeVisible();
});

test('unknown symbols return a helpful 404 without fetching all-market bias', async ({ page }) => {
  let biasRequests = 0;
  page.on('request', (request) => { if (request.url().includes('/api/bias')) biasRequests++; });
  const response = await page.goto('/markets/UNKNOWN');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Market not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to markets' })).toHaveAttribute('href', '/');
  expect(biasRequests).toBe(0);
});

test('neutral baseline and empty drivers or history have explicit states', async ({ page }) => {
  await mockBias(page, { ...detailFixture, source: 'baseline', stale: true, sourceHealth: { feed: 'failed' }, data: [{ ...market, direction: 'neutral', biasScore: 0, biasPercent: 0, events: [], history: [] }] });
  await page.goto('/markets/XAUUSD');
  await expect(page.getByText('No dominant fundamental direction in this read.')).toBeVisible();
  await expect(page.getByText('No bullish drivers in this read.')).toBeVisible();
  await expect(page.getByText('No bearish drivers in this read.')).toBeVisible();
  await expect(page.getByText('No daily snapshots yet.', { exact: false })).toBeVisible();
  await expect(page.getByText('Source mode: baseline.', { exact: false })).toContainText('Outdated read. Some providers are unavailable. Baseline inputs');
});

test('history uses date spacing, leaves missing days disconnected and handles one snapshot', async ({ page }) => {
  const history: BiasResult['history'] = [
    { date: '2026-11-03', biasScore: 12, direction: 'neutral' },
    { date: '2026-11-05', biasScore: 30, direction: 'weakly_bullish' },
    { date: '2026-11-06', biasScore: 42, direction: 'weakly_bullish' },
    { date: '2026-10-01', biasScore: -10, direction: 'neutral' },
  ];
  await mockBias(page, { ...detailFixture, data: [{ ...market, history }] });
  await page.goto('/markets/XAUUSD');
  await expect(page.locator('.research-history-point')).toHaveCount(3);
  await expect(page.locator('.research-history-line')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Daily bias history for XAUUSD' }).getByRole('row')).toHaveCount(4);
  await mockBias(page, { ...detailFixture, data: [{ ...market, history: history.slice(0, 1) }] });
  await page.getByRole('button', { name: 'Refresh analysis', exact: true }).click();
  await expect(page.getByText('One daily snapshot available.', { exact: false })).toBeVisible();
  await expect(page.locator('.research-history-point')).toHaveCount(1);
  await expect(page.locator('.research-history-line')).toHaveCount(0);
});

test('initial bias failure retries and a failed refresh retains the last read', async ({ page }) => {
  await mockBias(page, detailFixture, 503);
  await page.goto('/markets/XAUUSD');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Analysis could not be refreshed');
  await expect(page.getByText('Analysis for XAUUSD is unavailable.', { exact: false })).toBeVisible();
  await mockBias(page);
  await page.getByRole('button', { name: 'Refresh analysis', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Current market bias' })).toContainText('+42%');
  await mockBias(page, detailFixture, 503);
  await page.getByRole('button', { name: 'Refresh analysis', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('last successful read');
  await expect(page.getByRole('region', { name: 'Current market bias' })).toContainText('+42%');
});

test('missing selected result never displays a different market', async ({ page }) => {
  await page.route('**/api/bias*', (route) => route.fulfill({ json: { ...detailFixture, data: [fixture.data[1]] } }));
  await page.goto('/markets/XAUUSD');
  await expect(page.getByText('Analysis for XAUUSD is unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current market bias' })).toHaveCount(0);
});

test('calendar next release is symbol-scoped and empty scope does not fall back to another market', async ({ page }) => {
  await page.route('**/api/calendar', (route) => route.fulfill({ json: { ...calendarFixture, data: { ...calendarFixture.data, events: [...calendarFixture.data.events].reverse() } } }));
  await page.goto('/markets/XAUUSD');
  const calendar = page.getByRole('region', { name: 'Economic calendar', exact: true });
  await expect(calendar.getByText('Next release: US CPI fixture')).toBeVisible();
  await expect(calendar.getByText('Next release: UK GDP fixture')).toHaveCount(0);
  await page.route('**/api/calendar', (route) => route.fulfill({ json: { ...calendarFixture, data: { ...calendarFixture.data, events: calendarFixture.data.events.slice(1) } } }));
  await calendar.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(calendar.getByText('No upcoming high or medium impact release for XAUUSD', { exact: false })).toBeVisible();
});

test('calendar and macro errors leave healthy bias evidence usable and recover independently', async ({ page }) => {
  await page.route('**/api/calendar', (route) => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/macro-context', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/markets/BTCUSD');
  await expect(page.getByRole('region', { name: 'Current market bias' })).toContainText('-55%');
  await expect(page.getByText('Context refresh failed.', { exact: false })).toBeVisible();
  await expect(page.getByText('Calendar refresh failed.', { exact: false })).toBeVisible();
  await page.route('**/api/macro-context', (route) => route.fulfill({ json: macroFixture }));
  await page.getByRole('button', { name: 'Refresh context', exact: true }).click();
  await expect(page.getByText('4.46%', { exact: true })).toBeVisible();
  await expect(page.getByText('Calendar refresh failed.', { exact: false })).toBeVisible();
});

test('a symbol change abandons a slow prior request and reduced motion keeps controls usable', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/bias?symbol=XAUUSD', async (route) => {
    await gate;
    await route.fulfill({ json: { ...detailFixture, data: [market] } }).catch(() => {});
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/markets/XAUUSD');
  await expect(page.getByText('Loading XAUUSD analysis')).toBeVisible();
  await page.getByRole('navigation', { name: 'Choose a market' }).getByRole('link', { name: 'BTCUSD', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Current market bias' })).toContainText('-55%');
  release();
  await expect(page.getByRole('heading', { level: 1, name: 'BTCUSD', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current market bias' })).not.toContainText('+42%');
});
