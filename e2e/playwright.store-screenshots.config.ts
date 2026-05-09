import { defineConfig } from '@playwright/test';
import path from 'path';
import {
  TABLET_VIEWPORTS,
  VIEWPORTS,
  type ViewportSpec,
} from './store-screenshots/matrix';

/**
 * Separate Playwright config for the screenshot pipeline. Each viewport in the
 * matrix becomes its own `project` so the same scenario specs run unmodified
 * at every required pixel size — Playwright launches one context per project
 * with the right viewport/deviceScaleFactor.
 *
 * Outputs land in `.tmp/screenshots/_master/<viewport>/<locale>/<theme>/`.
 *
 * Run all viewports:    npm run screenshots:capture
 * Run one viewport:     npx playwright test --config e2e/playwright.store-screenshots.config.ts --project=desktopMaster
 */
export default defineConfig({
  testDir: path.join(__dirname, 'store-screenshots', 'scenarios'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Screenshots aren't flaky like e2e tests — failures should be investigated, not retried.
  retries: 0,
  workers: 1,
  reporter: 'line',

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4242',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    userAgent: 'PLAYWRIGHT-SCREENSHOTS',
    navigationTimeout: 45_000,
    actionTimeout: 20_000,
    launchOptions: {
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--hide-scrollbars',
      ],
    },
  },

  // matrix.ts stores OUTPUT (physical) dimensions; Playwright multiplies CSS
  // viewport by deviceScaleFactor when capturing — so divide here.
  // testMatch routes desktop/mobile specs to the right project so we don't pay
  // the seed-import + browser-launch cost for tests that would just skip.
  projects: (Object.entries(VIEWPORTS) as [string, ViewportSpec][]).map(([name, vp]) => {
    const dpr = vp.deviceScaleFactor ?? 1;
    const isMobile = vp.isMobile ?? false;
    const isTablet = (TABLET_VIEWPORTS as readonly string[]).includes(name);
    return {
      name,
      // Three-way split: tablets get their own spec because they render the
      // desktop layout but on a narrower / taller canvas than desktopMaster.
      testMatch: isTablet
        ? /scenarios\/tablet\/.+\.spec\.ts$/
        : isMobile
          ? /scenarios\/mobile\/.+\.spec\.ts$/
          : /scenarios\/desktop\/.+\.spec\.ts$/,
      use: {
        viewport: { width: vp.width / dpr, height: vp.height / dpr },
        deviceScaleFactor: dpr,
        isMobile,
        hasTouch: isMobile,
      },
    };
  }),

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

  outputDir: path.join(__dirname, '..', '.tmp', 'screenshots', '_test-results'),

  timeout: 180 * 1000,
  expect: { timeout: 20 * 1000 },
});
