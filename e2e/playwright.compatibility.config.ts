import { defineConfig, devices } from '@playwright/test';

// Opt-in: published app assets and an isolated local test server are required.
// No normal global setup: these tests must not substitute a development build.
export default defineConfig({
  testDir: './tests/sync',
  testMatch: 'supersync-released-client-compatibility.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: 'line',
  outputDir: '../.tmp/compatibility-results',
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    locale: 'en-GB',
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
});
