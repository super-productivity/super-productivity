import { defineConfig } from '@playwright/test';
import path from 'path';
import { VIEWPORTS, type ViewportSpec } from './store-screenshots/matrix';

/**
 * Electron-mode screenshot config.
 *
 * Re-uses the `scenarios/desktop/` specs from the web pipeline — the unified
 * fixture in `store-screenshots/fixture.ts` branches to Electron when
 * `SCREENSHOT_MODE=electron` is set (the npm script does that).
 *
 * Outputs land in `.tmp/screenshots/_master_electron/` and feed the Mac App
 * Store rule (and Flathub later). Run with:
 *
 *   npm run screenshots:capture:electron
 */
export default defineConfig({
  testDir: path.join(__dirname, 'store-screenshots', 'scenarios', 'desktop'),
  globalTeardown: path.join(__dirname, 'store-screenshots', 'print-output-path.ts'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4242',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },

  projects: [
    // Desktop master only — Electron pipeline doesn't do mobile.
    (() => {
      const vp = VIEWPORTS.desktopMaster as ViewportSpec;
      const dpr = vp.deviceScaleFactor ?? 1;
      return {
        name: 'desktopMaster',
        use: {
          viewport: { width: vp.width / dpr, height: vp.height / dpr },
          deviceScaleFactor: dpr,
        },
      };
    })(),
  ],

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

  outputDir: path.join(__dirname, '..', '.tmp', 'screenshots', '_test-results-electron'),

  // Electron startup adds ~5–10 s overhead per test. Loosen the cap.
  timeout: 240 * 1000,
  expect: { timeout: 20 * 1000 },
});
