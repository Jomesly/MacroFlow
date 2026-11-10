import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['calendar.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '.artifacts/calendar-browser-results',
  use: { ...devices['Desktop Chrome'], screenshot: 'only-on-failure', trace: 'off' },
});
