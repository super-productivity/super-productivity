/**
 * Performance benchmark against the production web build (`dist/browser`).
 * Kept outside `e2e/tests`, so `npm run e2e` never collects it. Run with
 * `npm run perf` (build + run) or `npm run perf:run` (existing build).
 */
import { defineConfig } from '@playwright/test';
import path from 'path';

export const PERF_PORT = 4250;
const REPO_ROOT = path.join(__dirname, '..', '..');

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.perf\.ts$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    baseURL: `http://localhost:${PERF_PORT}`,
    // Measurements must never include tracing/recording overhead.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    // Hashed bundles may be cached; index.html is re-validated per context anyway
    // because every sample starts in a fresh browser context.
    command: `npx http-server dist/browser -p ${PERF_PORT} -c3600 -s`,
    cwd: REPO_ROOT,
    url: `http://localhost:${PERF_PORT}`,
    // Never attach to a stray server: the numbers would belong to another build.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  outputDir: path.join(REPO_ROOT, '.tmp', 'perf', 'test-results'),
  // The large-account setup imports 10k tasks; the whole suite is one test per profile.
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
});
