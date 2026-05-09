import { defineConfig } from '@playwright/test';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');

/**
 * Playwright config for the marketing-reel video pipeline. Mirrors
 * `playwright.store-screenshots.config.ts` but records video via Playwright's
 * built-in `recordVideo` instead of capturing PNG frames. One run = one
 * continuous webm in `.tmp/video/_results/`. Post-process to mp4 / webm / gif
 * via `npm run video:build`.
 *
 *   Capture: npm run video:capture
 *   Build:   npm run video:build
 *   Both:    npm run video
 */
export default defineConfig({
  testDir: path.join(__dirname, 'store-video', 'scenarios'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Recordings aren't flaky — failures should be investigated, not retried.
  retries: 0,
  workers: 1,
  reporter: 'line',

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4242',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video recording, viewport, and deviceScaleFactor are all handled inside
    // the fixture (`store-video/fixture.ts`) because that fixture creates its
    // own browser context, which doesn't inherit project-level options.
    video: 'off',
    userAgent: 'PLAYWRIGHT-VIDEO',
    navigationTimeout: 45_000,
    actionTimeout: 20_000,
    launchOptions: {
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--hide-scrollbars',
      ],
    },
  },

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI
          ? 'npm run serveFrontend:e2e:prod'
          : 'npm run startFrontend:e2e',
        url: 'http://localhost:4242',
        reuseExistingServer: !process.env.CI,
        timeout: 2 * 60 * 1000,
        stdout: 'ignore',
        stderr: 'pipe',
      },

  outputDir: path.join(repoRoot, '.tmp', 'video', '_results'),

  timeout: 180 * 1000,
  expect: { timeout: 20 * 1000 },
});
