import { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

  // Build plugins before starting tests (skip if already built in CI)
  const pluginManifestPath = path.join(
    process.cwd(),
    'src/assets/bundled-plugins/api-test-plugin/manifest.json',
  );

  if (fs.existsSync(pluginManifestPath)) {
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
};

export default globalSetup;
