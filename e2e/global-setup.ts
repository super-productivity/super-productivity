import { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isServerHealthy } from './utils/supersync-helpers';

/**
 * Warm up the dev server by fetching the app once before any tests start.
 * This ensures Angular compilation is complete and cached, so all workers
 * get instant responses instead of competing for the first compilation.
 */
const warmUpDevServer = async (baseURL: string): Promise<void> => {
  console.log(`Warming up dev server at ${baseURL}...`);
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(30000) });
      if (response.ok) {
        // Read the full body to ensure the server finishes compilation
        await response.text();
        console.log('Dev server warm-up complete');
        return;
      }
    } catch {
      if (attempt < maxRetries - 1) {
        console.log(`Warm-up attempt ${attempt + 1} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  console.warn('Dev server warm-up failed — tests may be slow on first run');
};

const globalSetup = async (config: FullConfig): Promise<void> => {
  // Set test environment variables
  process.env.TZ = 'Europe/Berlin';
  process.env.NODE_ENV = 'test';
  console.log(`Running tests with ${config.workers} workers`);

  // Build plugins before starting tests (skip if already built)
  // Check both the dev path (src/assets/) and the CI pre-built path (.tmp/angular-dist/)
  const pluginManifestPath = path.join(
    process.cwd(),
    'src/assets/bundled-plugins/api-test-plugin/manifest.json',
  );
  const ciBuildManifestPath = path.join(
    process.cwd(),
    '.tmp/angular-dist/browser/assets/bundled-plugins/api-test-plugin/manifest.json',
  );

  if (fs.existsSync(pluginManifestPath) || fs.existsSync(ciBuildManifestPath)) {
    console.log('Plugins already built, skipping...');
  } else {
    console.log('Building bundled plugins...');
    try {
      execSync('npm run plugins:build', {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      console.log('Bundled plugins built successfully');
    } catch (error) {
      console.error('Failed to build plugins:', error);
      throw error; // Fail fast if plugin build fails
    }
  }

  // Warm up the dev server to pre-compile Angular bundles before workers start
  const baseURL =
    process.env.E2E_BASE_URL ||
    config.projects[0]?.use?.baseURL ||
    'http://localhost:4242';
  await warmUpDevServer(baseURL);

  // Check SuperSync server health ONCE here, before workers start.
  // Without this, each worker checks independently on startup — with many workers
  // running simultaneously, the concurrent health-check requests can overload the
  // supersync server and cause false negatives, making workers skip all their tests.
  // By storing the result in an env var set before workers are forked, every worker
  // reads the cached result instantly instead of making HTTP requests.
  const healthy = await isServerHealthy().catch(() => false);
  process.env.SUPERSYNC_SERVER_HEALTHY = healthy ? 'true' : 'false';
  if (healthy) {
    console.log('SuperSync server healthy — supersync tests will run');
  } else {
    console.log('SuperSync server not available — supersync tests will be skipped');
  }
};

export default globalSetup;
