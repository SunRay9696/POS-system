import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: '/tmp/squarebox-playwright-results',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3105',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1024 },
    launchOptions: {
      ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
      args: ['--no-sandbox'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node --import tsx tests/e2e-server.mjs',
    url: 'http://127.0.0.1:3105/api/health',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
