import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['auth.spec.ts', 'account-funds.spec.ts', 'journal-imports.spec.ts', 'journal-dashboard.spec.ts'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'], baseURL: process.env.MACROFLOW_ACCOUNT_TEST_BASE_URL || 'http://localhost:3137',
    screenshot: 'only-on-failure', trace: 'off',
  },
});
