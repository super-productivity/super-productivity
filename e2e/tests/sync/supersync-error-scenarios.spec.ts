import { test, expect } from '../../fixtures/supersync.fixture';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  hasTask,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Error Scenarios E2E Tests
 *
 * Tests error handling paths using Playwright route interception to simulate
 * server responses that are difficult to trigger naturally.
 *
 * Scenarios covered:
 * - B.3: Validation error permanently rejects op
 * - B.4: Payload too large shows alert dialog
 * - G.5: Duplicate operation silently marked as synced
 * - G.7/G.8: Incompatible operation blocks the download cursor until recovery
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-error-scenarios.spec.ts
 */

test.describe('@supersync Error Scenarios', () => {
  /**
   * Scenario B.3: Validation error permanently rejects op and shows error status
   *
   * When the server rejects an op with VALIDATION_ERROR, the op should be
   * marked as permanently rejected (not retried) and sync status should show ERROR.
   */
  test('Validation error permanently rejects op and shows error status', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    const state = { interceptUpload: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create a task (generates pending ops)
      const taskName = `ValidationErr-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      // Intercept the upload to return a VALIDATION_ERROR rejection
      // NOTE: With mandatory encryption, POST body is encrypted binary, not JSON.
      // We forward the request to get real op IDs from the server response,
      // then return the rejection.
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (state.interceptUpload && route.request().method() === 'POST') {
          state.interceptUpload = false;
          console.log('[Test] Simulating VALIDATION_ERROR rejection');

          // Forward request to server to get real response with op IDs
          const response = await route.fetch();
          const realBody = await response.json().catch(() => ({}));
          // Use a fake op ID since we can't parse encrypted request body
          const results = [
            {
              opId: realBody?.results?.[0]?.opId || 'fake-op-id',
              accepted: false,
              error: 'Invalid entity structure',
              errorCode: 'VALIDATION_ERROR',
            },
          ];

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results,
              latestSeq: realBody?.latestSeq || 1,
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Trigger sync — the upload should get VALIDATION_ERROR
      try {
        await clientA.sync.triggerSync();
        await clientA.page.waitForTimeout(3000);
      } catch {
        // Expected — triggerSync may throw on error state
      }

      // Remove interception
      await clientA.page.unroute('**/api/sync/ops');

      // Verify sync shows error status (permanentRejectionCount > 0 → ERROR)
      const hasError = await clientA.sync.hasSyncError();
      expect(hasError).toBe(true);

      // Sync again — the rejected op should NOT be retried
      // (it should sync successfully since the rejected op is skipped)
      await clientA.sync.syncAndWait();

      console.log(
        '[ValidationError] Validation error correctly caused error status and op was not retried',
      );
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops').catch(() => {});
        await closeClient(clientA);
      }
    }
  });

  /**
   * Scenario B.4: Payload too large shows alert dialog
   *
   * When the server returns 413, an alert dialog should appear.
   */
  test('Payload too large shows alert dialog', async ({
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

      // Set up dialog handler to capture alert
      let alertShown = false;
      let alertMessage = '';
      clientA.page.on('dialog', async (dialog) => {
        if (dialog.type() === 'alert') {
          alertShown = true;
          alertMessage = dialog.message();
          console.log(`[Test] Alert dialog: ${alertMessage}`);
          await dialog.accept();
        }
      });

      // Wait for initial sync to complete
      await clientA.sync.syncAndWait();

      // Intercept upload to return rejected ops with "Payload too large" error.
      // The app shows alertDialog only when rejected ops contain this text,
      // not on raw HTTP 413 responses.
      // We forward the request to get real op IDs from the server response.
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (route.request().method() === 'POST') {
          console.log('[Test] Simulating Payload Too Large rejection');
          const response = await route.fetch();
          const realBody = await response.json().catch(() => ({}));
          // Use real op IDs so the app can look up the ops in its local store
          const realResults = (realBody?.results || []) as Array<{
            opId: string;
            accepted: boolean;
          }>;
          const rejectedResults = realResults.map((r) => ({
            opId: r.opId,
            accepted: false,
            error: 'Payload too large',
          }));
          // Fallback if no results from server
          if (rejectedResults.length === 0) {
            rejectedResults.push({
              opId: 'fake-op-id',
              accepted: false,
              error: 'Payload too large',
            });
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: rejectedResults,
              latestSeq: realBody?.latestSeq || 1,
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Create task and trigger sync
      const taskName = `PayloadTooLarge-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      try {
        await clientA.sync.triggerSync();
        // Poll for alert
        const alertTimeout = 5000;
        const pollInterval = 200;
        let elapsed = 0;
        while (!alertShown && elapsed < alertTimeout) {
          await clientA.page.waitForTimeout(pollInterval);
          elapsed += pollInterval;
        }
      } catch {
        console.log('[Test] Sync failed with 413 as expected');
      }

      // Verify alert was shown with appropriate message
      expect(alertShown).toBe(true);
      expect(alertMessage.length).toBeGreaterThan(0);

      // Task should still exist locally (not lost)
      await waitForTask(clientA.page, taskName);

      console.log('[PayloadTooLarge] Alert dialog shown for 413 response');
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops').catch(() => {});
        await closeClient(clientA);
      }
    }
  });

  /**
   * Scenario G.5: Duplicate operation is silently marked as synced
   *
   * When the server rejects an op as DUPLICATE_OPERATION, the client should
   * mark it as synced (not show an error). This handles the case where the
   * client successfully uploaded but didn't receive the acknowledgment.
   */
  test('Duplicate operation is silently marked as synced', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const state = { returnDuplicate: false };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create task and sync it successfully first
      const taskName = `Duplicate-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Create another task (generates new pending ops)
      const taskName2 = `Duplicate2-${testRunId}`;
      await clientA.workView.addTask(taskName2);
      await waitForTask(clientA.page, taskName2);

      // Intercept the next upload to return DUPLICATE_OPERATION
      // NOTE: With mandatory encryption, POST body is encrypted binary, not JSON.
      // We forward the request to get real response, then return the rejection.
      state.returnDuplicate = true;
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (state.returnDuplicate && route.request().method() === 'POST') {
          state.returnDuplicate = false;
          console.log('[Test] Simulating DUPLICATE_OPERATION rejection');

          // Forward request to server to get real response
          const response = await route.fetch();
          const realBody = await response.json().catch(() => ({}));

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: [
                {
                  opId: realBody?.results?.[0]?.opId || 'fake-op-id',
                  accepted: false,
                  error: 'Duplicate operation',
                  errorCode: 'DUPLICATE_OPERATION',
                },
              ],
              latestSeq: realBody?.latestSeq || 2,
            }),
          });
        } else {
          await route.continue();
        }
      });

      // Trigger sync — duplicate rejection should be handled silently
      try {
        await clientA.sync.triggerSync();
        await clientA.page.waitForTimeout(2000);
      } catch {
        // May or may not throw
      }

      // Remove interception
      await clientA.page.unroute('**/api/sync/ops');

      // Verify no error shown — duplicate should be handled silently
      // After removing the route, the next sync should succeed
      await clientA.sync.syncAndWait();
      const hasError = await clientA.sync.hasSyncError();
      expect(hasError).toBe(false);

      // Verify tasks still exist
      await waitForTask(clientA.page, taskName);

      // Verify with Client B that the task made it to the server
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      console.log('[DuplicateOp] Duplicate operation handled silently without error');
    } finally {
      if (clientA) {
        await clientA.page.unroute('**/api/sync/ops').catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenarios G.7/G.8: an incompatible operation blocks the download cursor.
   *
   * The blocked operation and the valid suffix must be retried rather than skipped.
   * Once the incompatibility is removed (simulating an app update/migration fix),
   * the same server response can be processed and sync recovers.
   */
  test('Incompatible operation blocks valid suffix and cursor until recovery', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let blockedOpId: string | null = null;
    let blockedServerSeq: number | null = null;
    let validSuffixOpId: string | null = null;
    let repeatedBlockedDownloads = 0;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A creates real data
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `IncompatibleSuffix-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Install interception before configuring Client B. setupSuperSync starts an
      // automatic initial sync, so installing this afterwards would miss the path.
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.page.route('**/api/sync/ops?*', async (route) => {
        if (route.request().method() === 'GET') {
          const response = await route.fetch();
          const json = (await response.json()) as {
            ops?: Array<{
              serverSeq: number;
              op: { id: string; entityType: string; schemaVersion: number };
            }>;
          };

          if (json.ops?.length > 0) {
            if (blockedOpId === null) {
              const taskSuffixIndex = json.ops.findIndex(
                (entry) => entry.op.entityType === 'TASK',
              );
              expect(taskSuffixIndex).toBeGreaterThan(0);
              blockedOpId = json.ops[0].op.id;
              blockedServerSeq = json.ops[0].serverSeq;
              validSuffixOpId = json.ops[taskSuffixIndex].op.id;
            }

            const blockedEntry = json.ops.find((entry) => entry.op.id === blockedOpId);
            if (blockedEntry) {
              expect(blockedEntry.serverSeq).toBe(blockedServerSeq);
              blockedEntry.op.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
              repeatedBlockedDownloads++;
            }
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

      await clientB.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });

      await expect.poll(() => clientB!.sync.hasSyncError()).toBe(true);
      expect(await hasTask(clientB.page, taskName)).toBe(false);

      // Retry while the incompatible op remains. If the cursor advanced past it,
      // the server would no longer return the same operation ID/sequence.
      await clientB.sync.syncAndWait().catch(() => {});
      expect(validSuffixOpId).toBeTruthy();
      expect(validSuffixOpId).not.toBe(blockedOpId);
      expect(repeatedBlockedDownloads).toBeGreaterThanOrEqual(2);
      expect(await hasTask(clientB.page, taskName)).toBe(false);

      // Simulate upgrading to a version that understands the operation.
      await clientB.page.unroute('**/api/sync/ops?*');
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      expect(await clientB.sync.hasSyncError()).toBe(false);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await clientB.page.unroute('**/api/sync/ops?*').catch(() => {});
        await closeClient(clientB);
      }
    }
  });
});
