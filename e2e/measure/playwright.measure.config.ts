/**
 * Config for the manual measurement harnesses in this folder. They are profiling
 * tools, not assertions: they print numbers and always pass, so they live outside
 * `e2e/tests` and are never collected by `npm run e2e`.
 *
 *   npx playwright test --config e2e/measure/playwright.measure.config.ts \
 *     --project=measure-webkit
 *
 * WebKit is the point — it is the closest engine to the iOS WKWebView available
 * without a device. `measure-chromium` runs the same harness for comparison.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const IPHONE_13 = devices['iPhone 13'];
const REPO_ROOT = path.join(__dirname, '..', '..');

const MOBILE_CONTEXT = {
  viewport: IPHONE_13.viewport,
  screen: IPHONE_13.screen,
  deviceScaleFactor: IPHONE_13.deviceScaleFactor,
  isMobile: IPHONE_13.isMobile,
  hasTouch: IPHONE_13.hasTouch,
  locale: 'en-GB',
};

export default defineConfig({
  testDir: __dirname,
  // What actually keeps `npm run e2e` off these is `e2e/playwright.config.ts`
  // setting `testDir: e2e/tests` — this folder is outside its collected tree
  // entirely. The `*.measure.ts` suffix is a second, independent barrier.
  testMatch: /.*\.measure\.ts$/,
  // No globalSetup: the harnesses need no bundled plugins and no SuperSync server.
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4242',
    locale: 'en-GB',
    userAgent: 'PLAYWRIGHT',
    navigationTimeout: 60000,
    actionTimeout: 30000,
  },
  projects: [
    {
      name: 'measure-webkit',
      use: {
        browserName: 'webkit' as const,
        // The isolated-context fixture consumes contextOptions, so the mobile
        // descriptor has to be nested here rather than spread at use level.
        // No userAgent here on purpose: `test.fixture.ts` reads
        // `userAgent ?? contextOptions.userAgent`, and `use.userAgent` below is
        // always set, so a nested one would be dead. Both engines therefore run
        // as PLAYWRIGHT, which is what makes the two columns comparable.
        contextOptions: MOBILE_CONTEXT,
      },
    },
    {
      name: 'measure-chromium',
      use: {
        browserName: 'chromium' as const,
        contextOptions: MOBILE_CONTEXT,
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run startFrontend:e2e',
        url: 'http://localhost:4242',
        // Never reuse: attaching to a stray server on :4242 would file the
        // numbers under the wrong build, which is the one thing a measurement
        // harness must not do.
        reuseExistingServer: false,
        timeout: 4 * 60 * 1000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
  outputDir: path.join(REPO_ROOT, '.tmp', 'e2e-measure-results'),
  timeout: 300 * 1000,
  expect: { timeout: 30 * 1000 },
});
