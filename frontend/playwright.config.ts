import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4172', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'cargo run --locked -p quorum-web',
    env: { QUORUM_WEB_ADDR: '127.0.0.1:4172' },
    url: 'http://127.0.0.1:4172',
    timeout: 120_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGINT', timeout: 3000 },
  },
});
