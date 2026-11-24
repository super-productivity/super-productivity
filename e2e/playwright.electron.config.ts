import { defineConfig } from '@playwright/test';

// Requires buildFrontend:prod:es6 + electron:build. On Linux run under Xvfb;
// ELECTRON_PATH can select a platform-provided Electron executable.
export default defineConfig({
  testDir: './electron',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'line',
  outputDir: '../.tmp/electron-e2e-results',
});
