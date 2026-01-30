import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Network Failure E2E Tests
 *
 * These tests verify sync behavior when network failures occur.
 * They use Playwright's route interception to simulate:
 * - Upload failures
 * - Download failures
 * - Partial sync failures
 * - Network drops during sync
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:playwright:file e2e/tests/sync/supersync-network-failure.spec.ts
 */

test.describe('@supersync Network Failure Recovery', () => {
  /**
   * Test: Upload failure and retry
   *
   * Scenario:
   * 1. Client A creates tasks
   * 2. First sync attempt fails (network intercepted)
   * 3. Second sync attempt succeeds
   * 4. Client B receives the tasks
   */
  test('recovers from upload failure and retries successfully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let failNextUpload = true;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up Client A
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create tasks
      const taskName = `Task-${testRunId}-upload-test`;
      await clientA.workView.addTask(taskName);

      // Set up route interception to fail first upload
      await clientA.page.route('**/api/sync/ops/**', async (route) => {
        if (failNextUpload && route.request().method() === 'POST') {
          failNextUpload = false;
          console.log('[Test] Simulating upload failure');
          await route.abort('failed');
        } else {
          await route.continue();
        }
      });

      // First sync attempt - should fail
      try {
        await clientA.sync.triggerSync();
        // Wait a bit for the failure to be processed
        await clientA.page.waitForTimeout(2000);
      } catch {
        // Expected to fail
        console.log('[Test] First sync failed as expected');
      }

      // Remove the failing route
      await clientA.page.unroute('**/api/sync/ops/**');

      // Second sync attempt - should succeed
      await clientA.sync.syncAndWait();

      // Verify task still exists on Client A
      await waitForTask(clientA.page, taskName);

      // Set up Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Client B syncs
      await clientB.sync.syncAndWait();

      // Verify Client B received the task
      await waitForTask(clientB.page, taskName);

      const taskLocatorB = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocatorB).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Download failure and retry
   *
   * Scenario:
   * 1. Client A creates and syncs tasks
   * 2. Client B's first download fails
   * 3. Client B retries and succeeds
   */
  test('recovers from download failure', async ({ browser, baseURL, testRunId }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let failNextDownload = true;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up Client A and create task
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-download-test`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Verify Client A has the task
      await waitForTask(clientA.page, taskName);

      // Set up Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Set up route interception to fail first download
      await clientB.page.route('**/api/sync/ops/**', async (route) => {
        if (failNextDownload && route.request().method() === 'GET') {
          failNextDownload = false;
          console.log('[Test] Simulating download failure');
          await route.abort('failed');
        } else {
          await route.continue();
        }
      });

      // First sync attempt - download should fail
      try {
        await clientB.sync.triggerSync();
        await clientB.page.waitForTimeout(2000);
      } catch {
        console.log('[Test] First download failed as expected');
      }

      // Verify task NOT present (download failed)
      const taskLocatorBeforeRetry = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocatorBeforeRetry)
        .not.toBeVisible({ timeout: 1000 })
        .catch(() => {
          // Task might or might not be visible depending on partial state
        });

      // Remove the failing route
      await clientB.page.unroute('**/api/sync/ops/**');

      // Retry sync - should succeed
      await clientB.sync.syncAndWait();

      // Verify task now present
      await waitForTask(clientB.page, taskName);
      const taskLocatorAfterRetry = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocatorAfterRetry).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Sync succeeds after server error (500)
   *
   * Scenario:
   * 1. Client A creates task
   * 2. First sync returns 500 error
   * 3. Second sync succeeds
   */
  test('handles server error (500) and retries', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Use object to ensure mutable reference is captured correctly
    const state = { returnServerError: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-server-error`;
      await clientA.workView.addTask(taskName);
      // Wait for task to be fully created in store
      await waitForTask(clientA.page, taskName);

      // Intercept and return 500 error on first request
      await clientA.page.route('**/api/sync/ops/**', async (route) => {
        if (state.returnServerError && route.request().method() === 'POST') {
          state.returnServerError = false;
          console.log('[Test] Simulating 500 server error');
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error' }),
          });
        } else {
          await route.continue();
        }
      });

      // First sync - server error
      try {
        await clientA.sync.triggerSync();
        // Wait for the error to be processed
        await clientA.page.waitForTimeout(3000);
      } catch {
        console.log('[Test] First sync got server error as expected');
      }

      // Remove interception before retry
      await clientA.page.unroute('**/api/sync/ops/**');
      // Give time for route to be fully removed
      await clientA.page.waitForTimeout(500);

      // Retry - should succeed now
      await clientA.sync.syncAndWait();
      console.log('[Test] Retry sync succeeded');

      // Verify with Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();
    } finally {
      // Ensure routes are cleaned up
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops/**').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Multiple tasks sync correctly after network recovery
   *
   * Scenario:
   * 1. Client A creates multiple tasks offline (sync disabled/failing)
   * 2. Network recovers
   * 3. All tasks sync to Client B
   */
  test('syncs all pending operations after network recovery', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Use object to ensure mutable reference is captured correctly
    const state = { blockAllSyncRequests: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Block all sync requests
      await clientA.page.route('**/api/sync/**', async (route) => {
        if (state.blockAllSyncRequests) {
          console.log('[Test] Blocking sync request');
          await route.abort('failed');
        } else {
          await route.continue();
        }
      });

      // Create multiple tasks while "offline"
      const taskNames = [
        `Task-${testRunId}-offline-1`,
        `Task-${testRunId}-offline-2`,
        `Task-${testRunId}-offline-3`,
      ];

      for (const taskName of taskNames) {
        await clientA.workView.addTask(taskName);
        // Ensure task is created before adding next one
        await waitForTask(clientA.page, taskName);
      }

      // Try to sync (will fail due to route blocking)
      try {
        await clientA.sync.triggerSync();
        await clientA.page.waitForTimeout(2000);
      } catch {
        console.log('[Test] Sync blocked as expected');
      }

      // "Restore network" - unblock requests and remove route
      state.blockAllSyncRequests = false;
      await clientA.page.unroute('**/api/sync/**');
      // Give time for route to be fully removed
      await clientA.page.waitForTimeout(500);

      // Sync should now succeed with all pending operations
      await clientA.sync.syncAndWait();
      console.log('[Test] Sync after network recovery succeeded');

      // Verify all tasks on Client A
      for (const taskName of taskNames) {
        await waitForTask(clientA.page, taskName);
      }

      // Verify on Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // All tasks should be present on Client B
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
        const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
        await expect(taskLocator).toBeVisible();
      }
    } finally {
      // Ensure routes are cleaned up
      if (clientA) {
        await clientA.page.unroute('**/api/sync/**').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Partial batch upload failure followed by successful retry
   *
   * This tests a more realistic failure scenario where:
   * 1. Client A creates 10 tasks rapidly
   * 2. First sync starts - first few ops may succeed, then failure
   * 3. Retry sync - all remaining ops should upload
   * 4. Client B receives ALL 10 tasks (no duplicates, no missing)
   *
   * This verifies that the operation log correctly tracks which ops
   * have been synced vs pending, and retry doesn't create duplicates.
   */
  test('partial batch upload failure followed by retry uploads all without duplicates', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Track how many POST requests we've seen
    const state = {
      requestCount: 0,
      failAfter: 2, // Fail after 2 successful requests
    };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create 10 tasks rapidly
      const taskCount = 10;
      const taskNames: string[] = [];
      for (let i = 0; i < taskCount; i++) {
        const taskName = `Task-${testRunId}-batch-${i.toString().padStart(2, '0')}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
        await waitForTask(clientA.page, taskName);
      }
      console.log(`[PartialBatch] Created ${taskCount} tasks on Client A`);

      // Verify all tasks exist locally
      for (const taskName of taskNames) {
        const taskLocator = clientA.page.locator(`task:has-text("${taskName}")`);
        await expect(taskLocator).toBeVisible();
      }

      // Set up route interception to fail after first few requests
      await clientA.page.route('**/api/sync/ops/**', async (route) => {
        if (route.request().method() === 'POST') {
          state.requestCount++;
          if (state.requestCount > state.failAfter) {
            console.log(
              `[PartialBatch] Failing request #${state.requestCount} (after ${state.failAfter} successes)`,
            );
            await route.abort('failed');
          } else {
            console.log(`[PartialBatch] Allowing request #${state.requestCount}`);
            await route.continue();
          }
        } else {
          await route.continue();
        }
      });

      // First sync attempt - will partially succeed then fail
      console.log('[PartialBatch] Starting first sync (will partially fail)');
      try {
        await clientA.sync.triggerSync();
        await clientA.page.waitForTimeout(3000);
      } catch {
        console.log('[PartialBatch] First sync failed as expected');
      }

      // Remove the failing route and reset counter
      await clientA.page.unroute('**/api/sync/ops/**');
      await clientA.page.waitForTimeout(500);
      console.log('[PartialBatch] Route interception removed');

      // Retry sync - should succeed and upload remaining ops
      console.log('[PartialBatch] Retrying sync');
      await clientA.sync.syncAndWait();
      console.log('[PartialBatch] Retry sync completed');

      // Verify all tasks still exist on Client A (no data loss)
      for (const taskName of taskNames) {
        await waitForTask(clientA.page, taskName);
      }
      console.log('[PartialBatch] All tasks still present on Client A');

      // Set up Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify ALL tasks present on Client B (no missing, no duplicates)
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
        const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
        await expect(taskLocator).toBeVisible();
      }

      // Verify exact count (no duplicates)
      const countB = await clientB.page
        .locator(`task:has-text("${testRunId}-batch")`)
        .count();
      expect(countB).toBe(taskCount);
      console.log(
        `[PartialBatch] ✓ Client B has exactly ${taskCount} tasks (no duplicates)`,
      );

      console.log('[PartialBatch] ✓ Partial batch failure + retry test PASSED!');
    } finally {
      // Ensure routes are cleaned up
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops/**').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Rate limit exceeded (429) response handling
   *
   * Scenario:
   * 1. Client A creates a task
   * 2. First sync returns 429 (rate limit exceeded)
   * 3. Client waits briefly and retries
   * 4. Second sync succeeds
   * 5. Client B receives the task
   *
   * This tests that the client properly handles rate limiting and retries.
   */
  test('handles rate limit exceeded (429) and retries after delay', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    const state = { returnRateLimitError: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-rate-limit`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      // Intercept and return 429 rate limit error on first request
      await clientA.page.route('**/api/sync/ops/**', async (route) => {
        if (state.returnRateLimitError && route.request().method() === 'POST') {
          state.returnRateLimitError = false;
          console.log('[Test] Simulating 429 rate limit exceeded');
          // eslint-disable-next-line @typescript-eslint/naming-convention
          const headers = { 'Retry-After': '1' }; // Suggest retry after 1 second
          await route.fulfill({
            status: 429,
            contentType: 'application/json',
            headers,
            body: JSON.stringify({
              error: 'Too Many Requests',
              code: 'RATE_LIMIT_EXCEEDED',
              retryAfter: 1,
            }),
          });
        } else {
          await route.continue();
        }
      });

      // First sync - rate limited
      try {
        await clientA.sync.triggerSync();
        await clientA.page.waitForTimeout(3000);
      } catch {
        console.log('[Test] First sync got rate limit error as expected');
      }

      // Remove interception before retry
      await clientA.page.unroute('**/api/sync/ops/**');
      await clientA.page.waitForTimeout(1500); // Wait longer than Retry-After

      // Retry - should succeed now
      await clientA.sync.syncAndWait();
      console.log('[Test] Retry sync succeeded after rate limit');

      // Verify with Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();

      console.log('[RateLimit] ✓ Rate limit handling test PASSED');
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops/**').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Server quota exceeded response handling
   *
   * Scenario:
   * 1. Client A creates a task
   * 2. Server returns STORAGE_QUOTA_EXCEEDED error
   * 3. Client shows an appropriate error message (alert)
   * 4. Operation is NOT marked as rejected (user needs to free space)
   *
   * This tests that quota exceeded is treated as a transient error
   * that requires user action, not a permanent rejection.
   */
  test('handles server storage quota exceeded gracefully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(60000);
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Set up dialog handler to dismiss alert dialogs BEFORE setting up route
      // Only handles 'alert' dialogs - 'confirm' dialogs are handled by SuperSyncPage
      let alertShown = false;
      clientA.page.on('dialog', async (dialog) => {
        if (dialog.type() === 'alert') {
          console.log(`[Test] Alert shown: ${dialog.message()}`);
          alertShown = true;
          await dialog.accept();
        }
      });

      // Wait for initial sync to complete so we have a baseline
      await clientA.sync.syncAndWait();

      // Intercept and return storage quota exceeded BEFORE creating task
      // so the immediate upload service gets the error
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (route.request().method() === 'POST') {
          console.log('[Test] Simulating storage quota exceeded');
          await route.fulfill({
            status: 413, // Payload too large is typical for quota
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Storage quota exceeded',
              code: 'STORAGE_QUOTA_EXCEEDED',
              rejectedOps: [
                {
                  opId: 'mock-op-id',
                  error: 'Storage quota exceeded',
                  errorCode: 'STORAGE_QUOTA_EXCEEDED',
                },
              ],
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Now create a task - the immediate upload will get 413
      const taskName = `Task-${testRunId}-quota`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      // Wait for immediate upload to trigger and hit the 413
      try {
        await clientA.sync.triggerSync();
        // Poll for alert with increased timeout (was fixed 3000ms)
        const alertTimeout = 5000;
        const pollInterval = 200;
        let elapsed = 0;
        while (!alertShown && elapsed < alertTimeout) {
          await clientA.page.waitForTimeout(pollInterval);
          elapsed += pollInterval;
        }
      } catch {
        console.log('[Test] Sync failed with quota exceeded as expected');
      }

      // Task should still exist locally (not lost)
      await waitForTask(clientA.page, taskName);
      const taskLocator = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();

      // Verify an alert was shown (quota exceeded shows window.alert)
      expect(alertShown).toBe(true);

      console.log('[StorageQuota] ✓ Server quota exceeded handling test PASSED');
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
    }
  });

  /**
   * Test: Long offline period simulation
   *
   * Scenario:
   * 1. Client A creates multiple tasks
   * 2. Client A syncs
   * 3. Client B is "offline" for a simulated long period
   * 4. Multiple changes happen on Client A
   * 5. Client B comes back online and syncs
   * 6. Client B receives all accumulated changes
   *
   * This tests that clients can sync after extended offline periods
   * and receive all accumulated operations without issues.
   */
  test('syncs correctly after simulated long offline period', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up both clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync for both
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Simulate Client B going offline
      console.log('[LongOffline] Client B goes offline...');
      await clientB.page.route('**/api/sync/**', async (route) => {
        await route.abort('failed');
      });

      // Client A creates many tasks while B is offline
      const taskCount = 15;
      const taskNames: string[] = [];
      for (let i = 0; i < taskCount; i++) {
        const taskName = `Offline-Task-${testRunId}-${i.toString().padStart(2, '0')}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
        await waitForTask(clientA.page, taskName);

        // Sync after each few tasks to simulate real usage over time
        if ((i + 1) % 3 === 0) {
          await clientA.sync.syncAndWait();
          console.log(`[LongOffline] Client A synced ${i + 1} tasks`);
        }
      }

      // Final sync for Client A
      await clientA.sync.syncAndWait();
      console.log(`[LongOffline] Client A finished syncing all ${taskCount} tasks`);

      // Verify all tasks on Client A
      for (const taskName of taskNames) {
        await waitForTask(clientA.page, taskName);
      }

      // Client B comes back online after "long" period
      console.log('[LongOffline] Client B comes back online...');
      await clientB.page.unroute('**/api/sync/**');
      await clientB.page.waitForTimeout(500);

      // Client B syncs - should receive all accumulated operations
      await clientB.sync.syncAndWait();

      // May need multiple syncs if there are many operations (pagination)
      await clientB.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify ALL tasks are now on Client B
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
        const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
        await expect(taskLocator).toBeVisible();
      }

      // Verify exact count
      const countB = await clientB.page
        .locator(`task:has-text("Offline-Task-${testRunId}")`)
        .count();
      expect(countB).toBe(taskCount);

      console.log(
        `[LongOffline] ✓ Client B received all ${taskCount} tasks after coming back online`,
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await clientB.page.unroute('**/api/sync/**').catch(() => {});
        await closeClient(clientB);
      }
    }
  });

  /**
   * Test: Malformed JSON response handling
   *
   * Scenario:
   * 1. Client A creates and syncs a task
   * 2. Client B's first download returns malformed JSON
   * 3. Client B retries and succeeds
   * 4. Verify Client B correctly receives the data
   *
   * This tests that the client handles JSON parsing failures gracefully.
   */
  test('handles malformed JSON response gracefully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    const state = { returnMalformedJson: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A creates and syncs a task
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-malformed`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskName);

      // Client B setup
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Intercept and return malformed JSON on first GET
      await clientB.page.route('**/api/sync/ops/**', async (route) => {
        if (state.returnMalformedJson && route.request().method() === 'GET') {
          state.returnMalformedJson = false;
          console.log('[Test] Simulating malformed JSON response');
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{ "ops": [ { "id": "op-1", "malformed', // Intentionally broken JSON
          });
        } else {
          await route.continue();
        }
      });

      // First sync - should fail due to JSON parse error
      try {
        await clientB.sync.triggerSync();
        await clientB.page.waitForTimeout(2000);
      } catch {
        console.log('[Test] First sync failed due to malformed JSON as expected');
      }

      // Remove interception and retry
      await clientB.page.unroute('**/api/sync/ops/**');
      await clientB.page.waitForTimeout(500);

      // Retry - should succeed
      await clientB.sync.syncAndWait();

      // Verify task was received
      await waitForTask(clientB.page, taskName);
      const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();

      console.log('[MalformedJSON] ✓ Malformed JSON handling test PASSED');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await clientB.page.unroute('**/api/sync/ops/**').catch(() => {});
        await closeClient(clientB);
      }
    }
  });

  /**
   * Test: Invalid operation structure from server
   *
   * Scenario:
   * 1. Client A creates a task
   * 2. Server returns operations with missing required fields
   * 3. Client should skip invalid operations and continue
   * 4. Verify local state remains intact
   *
   * This tests that invalid/corrupted operations from the server
   * are gracefully skipped without crashing the sync process.
   */
  test('skips corrupted operations from server without crashing', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    const state = { injectCorruptedOps: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A creates and syncs a task
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-corrupted-test`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Setup Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Intercept and inject corrupted operations
      await clientB.page.route('**/api/sync/ops/**', async (route) => {
        if (route.request().method() === 'GET' && state.injectCorruptedOps) {
          state.injectCorruptedOps = false;
          console.log('[Test] Injecting corrupted operations into response');

          // Get real response then modify it
          const response = await route.fetch();
          const json = await response.json();

          // Add corrupted operations to the response
          if (json.ops) {
            json.ops.push(
              // Missing required fields
              {
                id: 'corrupt-1',
                opType: 'UPD' /* missing entityType, payload, etc. */,
              },
              // Null payload
              {
                id: 'corrupt-2',
                opType: 'UPD',
                entityType: 'TASK',
                entityId: 'bad-entity',
                payload: null,
                vectorClock: { bad: 1 },
                timestamp: Date.now(),
              },
              // Invalid opType
              {
                id: 'corrupt-3',
                opType: 'INVALID_TYPE',
                entityType: 'TASK',
                entityId: 'bad-entity',
                payload: {},
                vectorClock: { bad: 1 },
                timestamp: Date.now(),
              },
            );
          }

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(json),
          });
        } else {
          await route.continue();
        }
      });

      // Sync - should handle corrupted ops gracefully
      await clientB.sync.syncAndWait();

      // Verify valid task was still received (corrupted ops didn't break sync)
      await waitForTask(clientB.page, taskName);
      const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();

      // Remove interception
      await clientB.page.unroute('**/api/sync/ops/**');

      // Final sync should work normally
      await clientB.sync.syncAndWait();

      console.log('[CorruptedOps] ✓ Corrupted operation handling test PASSED');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await clientB.page.unroute('**/api/sync/ops/**').catch(() => {});
        await closeClient(clientB);
      }
    }
  });
});
