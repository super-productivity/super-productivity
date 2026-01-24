import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  /* Global setup */
  globalSetup: require.resolve(path.join(__dirname, 'global-setup')),
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry failed tests to handle flakiness */
  retries: process.env.CI ? 2 : 1,
  // Reduce worker count to avoid resource contention causing flakiness
  // Lower worker count improves stability by reducing parallel execution stress
  workers:
    (process.env.CI
      ? Math.min(3, os.cpus().length)
      : Math.min(12, os.cpus().length - 1)) || 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        [
          'html',
          {
            outputFolder: path.join(
              __dirname,
              '..',
              '.tmp',
              'e2e-test-results',
              'playwright-report',
            ),
            open: 'never',
          },
        ],
        [
          'junit',
          {
            outputFile: path.join(
              __dirname,
              '..',
              '.tmp',
              'e2e-test-results',
              'results.xml',
            ),
          },
        ],
      ]
    : process.env.PLAYWRIGHT_HTML_REPORT
      ? [
          [
            'html',
            {
              outputFolder: path.join(
                __dirname,
                '..',
                '.tmp',
                'e2e-test-results',
                'playwright-report',
              ),
              open: 'always',
            },
          ],
        ]
      : 'line',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4242',

    /* Configure downloads to go to test output directory, not ~/Downloads */
    downloadsPath: path.join(__dirname, '..', '.tmp', 'e2e-test-results', 'downloads'),

    /* Collect trace on failure for better debugging. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Browser options */
    userAgent: 'PLAYWRIGHT',

    /* Navigation timeout - increased for stability */
    navigationTimeout: 30000,

    /* Action timeout - increased for stability with Angular */
    actionTimeout: 15000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: {
          permissions: ['geolocation', 'notifications'],
          geolocation: { longitude: 0, latitude: 0 },
        },
        launchOptions: {
          args: [
            '--disable-dev-shm-usage',
            '--disable-browser-side-navigation',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-gpu', // Disable GPU for more stable headless execution
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling', // Prevent timer throttling
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
          ],
        },
      },
    },

    // Optionally test against other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  /* When E2E_BASE_URL is set (e.g., when using Docker), skip starting the server */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI
          ? 'npm run serveFrontend:e2e:prod'
          : 'npm run startFrontend:e2e',
        url: 'http://localhost:4242',
        reuseExistingServer: !process.env.CI, // Don't reuse in CI to ensure clean state
        timeout: process.env.CI ? 90000 : 3 * 60 * 1000,
        stdout: 'ignore', // Reduce log noise
        stderr: 'pipe',
      },

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: path.join(__dirname, '..', '.tmp', 'e2e-test-results', 'test-results'),

  /* Global timeout for each test - increased for Angular app stability */
  timeout: 90 * 1000,

  /* Global timeout for each assertion - increased for slow rendering */
  expect: {
    timeout: 20 * 1000,
  },

  /* Maximum test failures before stopping */
  maxFailures: process.env.CI ? undefined : 5,
});
