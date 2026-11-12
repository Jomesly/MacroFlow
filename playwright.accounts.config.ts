import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/accounts', workers: 1, fullyParallel: false, retries: 0,
  timeout: 90_000, expect: { timeout: 20_000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.MACROFLOW_ACCOUNT_TEST_BASE_URL || 'http://localhost:3001', screenshot: 'only-on-failure', trace: 'off' },
});
