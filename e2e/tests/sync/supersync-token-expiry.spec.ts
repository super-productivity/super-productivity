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
 * SuperSync Token Expiry Recovery E2E Tests
 *
 * Tests graceful recovery when auth token returns 401 during sync.
 * Uses Playwright route interception to simulate expired token responses.
 *
 * After a 401, the app clears stored credentials and shows a "Configure" snackbar.
 * Recovery requires re-entering credentials via the sync config dialog.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-token-expiry.spec.ts
 */

test.describe('@supersync Token Expiry Recovery', () => {
  /**
   * Scenario: Upload gets 401, re-authentication and retry succeeds
   *
   * Flow:
   * 1. Client A creates task, sets up sync
   * 2. Intercept upload to return 401 once
   * 3. First sync fails with auth error (app clears credentials)
   * 4. Remove interception, re-enter credentials via setupSuperSync
   * 5. Client B verifies task synced correctly
   */
  test('recovers from 401 on upload and retries successfully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const state = { return401: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create task
      const taskName = `Task-${testRunId}-token-expiry`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      // Intercept upload to return 401 once
      await clientA.page.route('**/api/sync/ops*', async (route) => {
        if (state.return401 && route.request().method() === 'POST') {
          state.return401 = false;
          console.log('[TokenExpiry] Simulating 401 Unauthorized on upload');
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Token expired' }),
          });
        } else {
          await route.continue();
        }
      });

      // First sync - should fail with 401
      try {
        await clientA.sync.triggerSync();
        await clientA.page.waitForTimeout(2000);
      } catch {
        console.log('[TokenExpiry] First sync failed with 401 as expected');
      }

      // Verify the 401 interception actually fired
      expect(state.return401).toBe(false);

      // Remove interception
      await clientA.page.unroute('**/api/sync/ops*');
      await clientA.page.waitForTimeout(500);

      // After 401, the app clears credentials and may show a config dialog.
      // Close any open dialogs before re-entering credentials.
      await clientA.sync.ensureOverlaysClosed();

      // Re-enter credentials (app cleared them on auth failure)
      await clientA.sync.setupSuperSync(syncConfig);

      // Sync again - should succeed now
      await clientA.sync.syncAndWait();
      console.log('[TokenExpiry] Retry sync succeeded');

      // Verify task still exists on Client A
      await waitForTask(clientA.page, taskName);

      // Verify with Client B
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();

      console.log('[TokenExpiry] ✓ Upload 401 recovery test PASSED');
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops*').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Download gets 401, re-authentication and retry succeeds
   *
   * Flow:
   * 1. Client A creates and syncs task
   * 2. Client B sets up, intercept download to return 401 once
   * 3. First download fails (app clears credentials)
   * 4. Remove interception, re-enter credentials
   * 5. Retry succeeds, Client B gets the task
   */
  test('recovers from 401 on download and retries successfully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const state = { return401: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A creates and syncs task
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-download-401`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskName);
      console.log('[TokenExpiry] Client A created and synced task');

      // Client B setup
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Intercept download to return 401 once
      await clientB.page.route('**/api/sync/ops*', async (route) => {
        if (state.return401 && route.request().method() === 'GET') {
          state.return401 = false;
          console.log('[TokenExpiry] Simulating 401 Unauthorized on download');
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Token expired' }),
          });
        } else {
          await route.continue();
        }
      });

      // First sync - download should fail
      try {
        await clientB.sync.triggerSync();
        await clientB.page.waitForTimeout(2000);
      } catch {
        console.log('[TokenExpiry] First download failed with 401 as expected');
      }

      // Verify the 401 interception actually fired
      expect(state.return401).toBe(false);

      // Remove interception
      await clientB.page.unroute('**/api/sync/ops*');
      await clientB.page.waitForTimeout(500);

      // After 401, the app clears credentials and may show a config dialog.
      // Close any open dialogs before re-entering credentials.
      await clientB.sync.ensureOverlaysClosed();

      // Re-enter credentials (app cleared them on auth failure)
      await clientB.sync.setupSuperSync(syncConfig);

      // Sync again - should succeed
      await clientB.sync.syncAndWait();

      // Verify task received
      await waitForTask(clientB.page, taskName);
      const taskLocator = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocator).toBeVisible();

      console.log('[TokenExpiry] ✓ Download 401 recovery test PASSED');
    } finally {
      if (clientB) {
        await clientB.page.unroute('**/api/sync/ops*').catch(() => {});
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
