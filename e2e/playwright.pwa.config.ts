import { defineConfig } from '@playwright/test';
import path from 'path';
import baseConfig from './playwright.config';

const PWA_BASE_URL = 'http://localhost:4243';

export default defineConfig({
  ...baseConfig,
  globalSetup: undefined,
  testDir: path.join(__dirname, 'pwa'),
  fullyParallel: false,
  workers: 1,
  use: {
    ...baseConfig.use,
    baseURL: PWA_BASE_URL,
  },
  projects: baseConfig.projects?.filter((project) => project.name === 'chromium'),
  webServer: {
    command: 'npm run serveFrontend:e2e:pwa',
    url: PWA_BASE_URL,
    reuseExistingServer: false,
    timeout: 2 * 60 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  outputDir: path.join(__dirname, '..', '.tmp', 'e2e-test-results', 'pwa-test-results'),
});
