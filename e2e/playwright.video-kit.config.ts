import { defineConfig } from '@playwright/test';
import path from 'path';

/**
 * Behavior tests for `e2e/video-kit` against routed static pages. No app
 * server: the kit must work on any page, and these run in seconds.
 *
 *   npm run video:kit-test
 */
export default defineConfig({
  testDir: path.join(__dirname, 'video-kit'),
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'line',
  use: {
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--disable-gpu', '--hide-scrollbars'] },
  },
  outputDir: path.join(__dirname, '..', '.tmp', 'video-kit', '_results'),
  timeout: 30 * 1000,
});
