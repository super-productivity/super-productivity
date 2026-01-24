import { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
};

export default globalSetup;
