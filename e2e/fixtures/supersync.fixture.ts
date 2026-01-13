import { test as base } from '@playwright/test';
import {
  isServerHealthy,
  generateTestRunId,
  type SimulatedE2EClient,
} from '../utils/supersync-helpers';

/**
 * Extended test fixture for SuperSync E2E tests.
 *
 * Provides:
 * - Automatic server health check (skips tests if server unavailable)
 * - Unique testRunId per test for data isolation
 * - Client tracking for automatic cleanup
 *
 * IMPORTANT: SuperSync tests create multiple browser contexts per test (2-3 clients).
 * Running with too many workers (e.g., 12) can overwhelm the Angular dev server,
 * causing ERR_CONNECTION_REFUSED errors. Recommended: --workers=3 or use the
 * npm run e2e:supersync script which limits workers appropriately.
 *
 * Usage:
 * ```typescript
 * import { test, expect } from '../../fixtures/supersync.fixture';
 *
 * test.describe('@supersync My Tests', () => {
 *   test('should sync', async ({ browser, baseURL, testRunId }) => {
 *     // testRunId is automatically generated and unique per test
 *   });
 * });
 * ```
 */

export interface SuperSyncFixtures {
  /** Unique test run ID for data isolation (e.g., "1704067200000-0") */
  testRunId: string;
  /** Whether the SuperSync server is healthy and available */
  serverHealthy: boolean;
}

// Cache server health check result per worker to avoid repeated checks
let serverHealthyCache: boolean | null = null;

export const test = base.extend<SuperSyncFixtures>({
  /**
   * Generate a unique test run ID for this test.
   * Used to isolate test data between parallel test runs.
   * Also checks server health and skips test if server unavailable.
   */
  testRunId: async ({}, use, testInfo) => {
    // Check server health once per worker
    if (serverHealthyCache === null) {
      serverHealthyCache = await isServerHealthy();
      if (!serverHealthyCache) {
        console.warn(
          'SuperSync server not healthy at http://localhost:1901 - skipping tests',
        );
      }
    }

    // Skip if server not healthy
    testInfo.skip(!serverHealthyCache, 'SuperSync server not running');

    const id = generateTestRunId(testInfo.workerIndex);
    await use(id);
  },

  /**
   * Check server health once per worker and cache the result.
   * Tests are automatically skipped if the server is not healthy.
   */
  serverHealthy: async ({}, use, testInfo) => {
    // Only check once per worker
    if (serverHealthyCache === null) {
      serverHealthyCache = await isServerHealthy();
      if (!serverHealthyCache) {
        console.warn(
          'SuperSync server not healthy at http://localhost:1901 - skipping tests',
        );
      }
    }

    // Skip the test if server is not healthy
    testInfo.skip(!serverHealthyCache, 'SuperSync server not running');

    await use(serverHealthyCache);
  },
});

/**
 * Helper to create a describe block that auto-checks server health.
 * Use this instead of manually adding beforeEach health checks.
 *
 * @param title - Test suite title (will be prefixed with @supersync)
 * @param fn - Test suite function
 *
 * @example
 * ```typescript
 * supersyncDescribe('Basic Sync', () => {
 *   test('should create and sync task', async ({ browser, baseURL, testRunId }) => {
 *     // Server health already checked, testRunId ready
 *   });
 * });
 * ```
 */
export const supersyncDescribe = (title: string, fn: () => void): void => {
  test.describe(`@supersync ${title}`, () => {
    // The serverHealthy fixture will auto-skip if server unavailable
    test.beforeEach(async ({ serverHealthy }) => {
      // This line ensures the fixture is evaluated and test is skipped if needed
      void serverHealthy;
    });
    fn();
  });
};

/**
 * Track clients for automatic cleanup in afterEach.
 * Use with `trackClient` and `cleanupTrackedClients`.
 */
const trackedClients = new Map<string, SimulatedE2EClient[]>();

/**
 * Track a client for automatic cleanup.
 * Call this when creating clients so they're cleaned up even if the test fails.
 *
 * @param testId - A unique ID for this test (use testInfo.testId)
 * @param client - The client to track
 */
export const trackClient = (testId: string, client: SimulatedE2EClient): void => {
  if (!trackedClients.has(testId)) {
    trackedClients.set(testId, []);
  }
  trackedClients.get(testId)!.push(client);
};

/**
 * Clean up all tracked clients for a test.
 * Call this in afterEach or finally blocks.
 *
 * @param testId - The test ID used when tracking clients
 */
export const cleanupTrackedClients = async (testId: string): Promise<void> => {
  const clients = trackedClients.get(testId);
  if (clients) {
    for (const client of clients) {
      try {
        if (!client.page.isClosed()) {
          await client.context.close();
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    trackedClients.delete(testId);
  }
};

// Re-export expect for convenience
export { expect } from '@playwright/test';
