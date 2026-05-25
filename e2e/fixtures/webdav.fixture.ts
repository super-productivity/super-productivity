import { test as base } from '@playwright/test';
import { isWebDavServerUp } from '../utils/check-webdav';

/**
 * Extended test fixture for WebDAV E2E tests.
 *
 * Provides:
 * - Automatic server health check (skips tests if server unavailable)
 * - Worker-level caching to avoid redundant health checks
 *
 * This reduces health check overhead from ~8s to ~2s when WebDAV is unavailable
 * by checking once per worker instead of once per test file.
 *
 * Usage:
 * ```typescript
 * import { test, expect } from '../../fixtures/webdav.fixture';
 *
 * test.describe('@webdav My Tests', () => {
 *   test('should sync', async ({ page, request }) => {
 *     // Server health already checked, test will skip if unavailable
 *   });
 * });
 * ```
 */

export interface WebDavFixtures {
  /** Whether the WebDAV server is reachable and available */
  webdavServerUp: boolean;
}

// Cache server health check result per worker to avoid repeated checks
let serverHealthCache: boolean | null = null;

export const test = base.extend<WebDavFixtures>({
  /**
   * Check WebDAV server health once per worker and cache the result.
   * Tests are automatically skipped if the server is not reachable.
   */
  webdavServerUp: async ({}, use, testInfo) => {
    // Only check once per worker
    if (serverHealthCache === null) {
      serverHealthCache = await isWebDavServerUp();
      if (!serverHealthCache) {
        console.warn(
          'WebDAV server not reachable at http://127.0.0.1:2345/ - skipping tests',
        );
      }
    }

    // Skip the test if server is not reachable
    testInfo.skip(!serverHealthCache, 'WebDAV server not reachable');

    await use(serverHealthCache);
  },
});

/**
 * Helper to create a describe block that auto-checks WebDAV server health.
 * Use this instead of manually adding beforeAll health checks.
 *
 * @param title - Test suite title (will be prefixed with @webdav)
 * @param fn - Test suite function
 *
 * @example
 * ```typescript
 * webdavDescribe('Archive Sync', () => {
 *   test('should sync archive', async ({ page, webdavServerUp }) => {
 *     // Server health already checked
 *   });
 * });
 * ```
 */
export const webdavDescribe = (title: string, fn: () => void): void => {
  test.describe(`@webdav ${title}`, () => {
    // The webdavServerUp fixture will auto-skip if server unavailable
    test.beforeEach(async ({ webdavServerUp }) => {
      // This line ensures the fixture is evaluated and test is skipped if needed
      void webdavServerUp;
    });
    fn();
  });
};

// Re-export expect for convenience
export { expect } from '@playwright/test';
