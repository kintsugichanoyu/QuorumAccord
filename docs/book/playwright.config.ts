import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4171', headless: true, viewport: { width: 1280, height: 850 } },
  webServer: { command: 'node --experimental-strip-types scripts/static-serve.ts', url: 'http://127.0.0.1:4171',
    reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 } },
});
