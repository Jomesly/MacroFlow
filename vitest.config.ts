import { defineConfig, configDefaults } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], setupFiles: ['./src/test/setup.ts'], exclude: [...configDefaults.exclude, 'tests/e2e/**'] },
});
