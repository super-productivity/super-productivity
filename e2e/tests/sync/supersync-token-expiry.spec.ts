import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  installDomRecorder,
  readDomRecord,
  SNACK_SELECTOR,
} from '../../utils/audit-error-paths-helpers';

const AUTH_TOKEN_REJECTED_SNACK = 'Sync token was rejected by the server';

/**
 * One 401 must surface as an error (icon plus the "token rejected" snack) while
 * the stored token is kept: SyncWrapperService tolerates two consecutive
 * SuperSync 401s and clears credentials only on the third.
 */
const expectTokenRejectedError = async (client: SimulatedE2EClient): Promise<void> => {
  await expect(client.sync.syncErrorIcon).toBeVisible({ timeout: 15000 });
  await expect
    .poll(
      async () =>
        (await readDomRecord(client.page, 'snacks')).texts.some((text) =>
          text.includes(AUTH_TOKEN_REJECTED_SNACK),
        ),
      { message: 'the "token rejected" snack must appear', timeout: 10000 },
    )
    .toBe(true);
};

/**
 * SuperSync Token Expiry Recovery E2E Tests
 *
 * Tests graceful recovery when auth token returns 401 during sync.
 * Uses Playwright route interception to simulate one 401 response.
 *
 * A single 401 shows the sync error icon and a "token rejected" snackbar but
 * keeps the stored token (two transient 401s are tolerated; the third clears
 * it). So once the server accepts the token again, a plain sync recovers with
 * no re-setup.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-token-expiry.spec.ts
 */

test.describe('@supersync Token Expiry Recovery', () => {
  /**
   * Scenario: Upload gets one 401, then a plain retry succeeds
   *
   * Flow:
   * 1. Client A creates task, sets up sync
   * 2. Intercept upload to return 401 once
   * 3. First sync fails: error icon and "token rejected" snack; token kept
   * 4. Remove interception, sync again with the stored token (no re-setup)
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

      await installDomRecorder(clientA.page, 'snacks', SNACK_SELECTOR);

      // First sync - should fail with 401
      // A raw click: triggerSync() waits for a successful cycle and would sit
      // out its timeout on the expected 401.
      await clientA.sync.clickSyncBtn();

      // Verify the 401 interception actually fired, and was surfaced
      expect(state.return401).toBe(false);
      await expectTokenRejectedError(clientA);

      // Remove interception
      await clientA.page.unroute('**/api/sync/ops*');

      // Sync again with the stored token (no re-setup) - should succeed now
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
   * Scenario: Download gets one 401, then a plain retry succeeds
   *
   * Flow:
   * 1. Client A creates and syncs task
   * 2. Client B sets up, intercept download to return 401 once
   * 3. First download fails: error icon and "token rejected" snack; token kept
   * 4. Remove interception, sync again with the stored token (no re-setup)
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

      await installDomRecorder(clientB.page, 'snacks', SNACK_SELECTOR);

      // First sync - download should fail
      // A raw click: triggerSync() waits for a successful cycle and would sit
      // out its timeout on the expected 401.
      await clientB.sync.clickSyncBtn();

      // Verify the 401 interception actually fired, and was surfaced
      expect(state.return401).toBe(false);
      await expectTokenRejectedError(clientB);

      // Remove interception
      await clientB.page.unroute('**/api/sync/ops*');

      // Sync again with the stored token (no re-setup) - should succeed
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
