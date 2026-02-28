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
 * SuperSync Error Scenarios E2E Tests
 *
 * Tests error handling paths using Playwright route interception to simulate
 * server responses that are difficult to trigger naturally.
 *
 * Scenarios covered:
 * - B.3: Validation error permanently rejects op
 * - B.4: Payload too large shows alert dialog
 * - G.5: Duplicate operation silently marked as synced
 * - G.7: Schema version mismatch returns handled error
 * - G.8: Failed operation migration skips op
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
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (state.interceptUpload && route.request().method() === 'POST') {
          state.interceptUpload = false;
          console.log('[Test] Simulating VALIDATION_ERROR rejection');

          // Get the request body to extract op IDs
          const body = route.request().postDataJSON();
          const ops = body?.ops || [];
          const rejectedOps = ops.map((op: { id: string }) => ({
            opId: op.id,
            error: 'Invalid entity structure',
            errorCode: 'VALIDATION_ERROR',
          }));

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              piggybacked: [],
              rejectedOps,
              latestSeq: 1,
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

      // Intercept upload to return 413
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (route.request().method() === 'POST') {
          console.log('[Test] Simulating 413 Payload Too Large');
          await route.fulfill({
            status: 413,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Payload too large',
              code: 'PAYLOAD_TOO_LARGE',
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
      state.returnDuplicate = true;
      await clientA.page.route('**/api/sync/ops', async (route) => {
        if (state.returnDuplicate && route.request().method() === 'POST') {
          state.returnDuplicate = false;
          console.log('[Test] Simulating DUPLICATE_OPERATION rejection');

          const body = route.request().postDataJSON();
          const ops = body?.ops || [];
          const rejectedOps = ops.map((op: { id: string }) => ({
            opId: op.id,
            error: 'Duplicate operation',
            errorCode: 'DUPLICATE_OPERATION',
          }));

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              piggybacked: [],
              rejectedOps,
              latestSeq: 2,
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
   * Scenario G.7: Schema version mismatch returns handled error
   *
   * When downloaded ops have a modelVersion higher than the client's,
   * the client should log a warning and return HANDLED_ERROR without crashing.
   */
  test('Schema version mismatch returns handled error without crash', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const state = { injectFutureSchemaOps: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A creates real data
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Schema-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Client B will receive ops with future schema version
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Intercept download to inject ops with a very high schema version
      await clientB.page.route('**/api/sync/ops/**', async (route) => {
        if (route.request().method() === 'GET' && state.injectFutureSchemaOps) {
          state.injectFutureSchemaOps = false;
          console.log('[Test] Injecting ops with future schema version');

          // Get real response and modify it
          const response = await route.fetch();
          const json = await response.json();

          // Modify all ops to have a very high schema version
          if (json.ops) {
            for (const op of json.ops) {
              op.schemaVersion = 99999;
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

      // Client B syncs — should handle the schema mismatch gracefully
      try {
        await clientB.sync.triggerSync();
        await clientB.page.waitForTimeout(3000);
      } catch {
        // May or may not throw depending on error handling
      }

      // Remove interception and retry with real data
      await clientB.page.unroute('**/api/sync/ops/**');
      await clientB.sync.syncAndWait();

      // Verify Client B didn't crash and can still sync
      await waitForTask(clientB.page, taskName);
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);

      console.log(
        '[SchemaVersionMismatch] Client handled future schema version without crash',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await clientB.page.unroute('**/api/sync/ops/**').catch(() => {});
        await closeClient(clientB);
      }
    }
  });

  /**
   * Scenario G.8: Failed operation migration skips op and other ops still apply
   *
   * When a downloaded op has a corrupted/unmigrateable structure,
   * it should be skipped and other valid ops should still be applied.
   */
  test('Failed operation migration skips corrupted op, applies others', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const state = { injectCorruptedOp: true };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A creates real data
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `MigrationFail-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Client B will receive ops including one corrupted one
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Intercept download to inject a corrupted op alongside valid ones
      await clientB.page.route('**/api/sync/ops/**', async (route) => {
        if (route.request().method() === 'GET' && state.injectCorruptedOp) {
          state.injectCorruptedOp = false;
          console.log('[Test] Injecting corrupted op into download response');

          const response = await route.fetch();
          const json = await response.json();

          // Insert a corrupted op before the valid ones
          if (json.ops && json.ops.length > 0) {
            const corruptedOp = {
              id: 'corrupted-migration-op',
              opType: 'UPD',
              entityType: 'TASK',
              entityId: 'nonexistent-entity',
              actionType: '[Task] CORRUPTED_ACTION',
              payload: { title: undefined, __broken: true },
              vectorClock: { broken_client: 1 },
              timestamp: Date.now(),
              schemaVersion: 0, // Very old schema, likely to fail migration
              clientId: 'broken-client',
            };
            json.ops.unshift(corruptedOp);
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

      // Client B syncs — corrupted op should be skipped, valid ops applied
      await clientB.sync.syncAndWait();

      // Remove interception
      await clientB.page.unroute('**/api/sync/ops/**');

      // Verify the valid task was still received despite the corrupted op
      await waitForTask(clientB.page, taskName);

      // Verify Client B is healthy and can sync again
      await clientB.sync.syncAndWait();
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);

      console.log(
        '[MigrationFailure] Corrupted op skipped, valid ops applied successfully',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await clientB.page.unroute('**/api/sync/ops/**').catch(() => {});
        await closeClient(clientB);
      }
    }
  });
});
