import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  parseSuperSyncRequestBody,
  routeSuperSyncOps,
  unrouteSuperSyncOps,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

interface MutableServerOperation {
  op?: {
    id?: string;
    schemaVersion?: number;
  };
}

interface OperationDownloadBody {
  ops?: MutableServerOperation[];
}

interface OperationUploadBody {
  ops: Array<{ id: string }>;
}

const getSuperSyncCursor = async (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('super_sync_last_server_seq_'),
    );
    return key ? localStorage.getItem(key) : null;
  });

const areLocalOperationsSynced = (page: Page, operationIds: string[]): Promise<boolean> =>
  page.evaluate(async (ids) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open('SUP_OPS');
      openRequest.onsuccess = (): void => resolve(openRequest.result);
      openRequest.onerror = (): void => reject(openRequest.error);
    });
    try {
      const entries = await Promise.all(
        ids.map(
          (id) =>
            new Promise<{ syncedAt?: number; rejectedAt?: number } | undefined>(
              (resolve, reject) => {
                const tx = db.transaction('ops', 'readonly');
                const getRequest = tx.objectStore('ops').index('byId').get(id);
                getRequest.onsuccess = (): void =>
                  resolve(
                    getRequest.result as
                      | { syncedAt?: number; rejectedAt?: number }
                      | undefined,
                  );
                getRequest.onerror = (): void => reject(getRequest.error);
              },
            ),
        ),
      );
      return (
        ids.length > 0 &&
        entries.every(
          (entry) => entry?.syncedAt !== undefined && entry.rejectedAt === undefined,
        )
      );
    } finally {
      db.close();
    }
  }, operationIds);

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
    const rejectedOpIds: string[] = [];
    const subsequentUploadIds: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create a task (generates pending ops)
      const taskName = `ValidationErr-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      // Intercept the upload and reject the exact operation IDs emitted by the client.
      await routeSuperSyncOps(clientA.page, async (route) => {
        if (state.interceptUpload && route.request().method() === 'POST') {
          state.interceptUpload = false;
          console.log('[Test] Simulating VALIDATION_ERROR rejection');

          const upload = parseSuperSyncRequestBody<OperationUploadBody>(route.request());
          rejectedOpIds.push(...upload.ops.map((operation) => operation.id));
          expect(rejectedOpIds.length).toBeGreaterThan(0);
          const results = upload.ops.map((operation) => ({
            opId: operation.id,
            accepted: false,
            error: 'Invalid entity structure',
            errorCode: 'VALIDATION_ERROR',
          }));

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results,
              latestSeq: 0,
            }),
          });
        } else if (route.request().method() === 'POST') {
          const upload = parseSuperSyncRequestBody<OperationUploadBody>(route.request());
          subsequentUploadIds.push(...upload.ops.map((operation) => operation.id));
          await route.continue();
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

      // Verify sync shows error status (permanentRejectionCount > 0 → ERROR)
      const hasError = await clientA.sync.hasSyncError();
      expect(hasError).toBe(true);

      // Sync again — the rejected op should NOT be retried
      // (it should sync successfully since the rejected op is skipped)
      await clientA.sync.syncAndWait();
      expect(subsequentUploadIds).not.toEqual(expect.arrayContaining(rejectedOpIds));
      await unrouteSuperSyncOps(clientA.page);

      console.log(
        '[ValidationError] Validation error correctly caused error status and op was not retried',
      );
    } finally {
      if (clientA) {
        await unrouteSuperSyncOps(clientA.page).catch(() => {});
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
    const rejectedOpIds: string[] = [];

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
      await routeSuperSyncOps(clientA.page, async (route) => {
        if (route.request().method() === 'POST') {
          console.log('[Test] Simulating Payload Too Large rejection');
          const upload = parseSuperSyncRequestBody<OperationUploadBody>(route.request());
          rejectedOpIds.push(...upload.ops.map((operation) => operation.id));
          expect(rejectedOpIds.length).toBeGreaterThan(0);
          const rejectedResults = upload.ops.map((operation) => ({
            opId: operation.id,
            accepted: false,
            error: 'Payload too large',
          }));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: rejectedResults,
              latestSeq: 0,
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
      expect(rejectedOpIds.length).toBeGreaterThan(0);
      expect(alertShown).toBe(true);
      expect(alertMessage.length).toBeGreaterThan(0);

      // Task should still exist locally (not lost)
      await waitForTask(clientA.page, taskName);

      console.log('[PayloadTooLarge] Alert dialog shown for 413 response');
    } finally {
      if (clientA) {
        await unrouteSuperSyncOps(clientA.page).catch(() => {});
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
    const duplicateOpIds: string[] = [];

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
      // The server accepts the upload, but the client receives a duplicate response
      // for the exact IDs it sent (the lost-acknowledgement recovery case).
      state.returnDuplicate = true;
      await routeSuperSyncOps(clientA.page, async (route) => {
        if (state.returnDuplicate && route.request().method() === 'POST') {
          state.returnDuplicate = false;
          console.log('[Test] Simulating DUPLICATE_OPERATION rejection');

          const upload = parseSuperSyncRequestBody<OperationUploadBody>(route.request());
          duplicateOpIds.push(...upload.ops.map((operation) => operation.id));
          expect(duplicateOpIds.length).toBeGreaterThan(0);
          const response = await route.fetch();
          const realBody = (await response.json()) as { latestSeq?: number };

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: upload.ops.map((operation) => ({
                opId: operation.id,
                accepted: false,
                error: 'Duplicate operation',
                errorCode: 'DUPLICATE_OPERATION',
              })),
              latestSeq: realBody.latestSeq ?? 0,
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

      await expect
        .poll(() => areLocalOperationsSynced(clientA!.page, duplicateOpIds), {
          message: 'the duplicate response must acknowledge the exact uploaded ops',
        })
        .toBe(true);

      // Remove interception
      await unrouteSuperSyncOps(clientA.page);

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
      await waitForTask(clientB.page, taskName2);

      console.log('[DuplicateOp] Duplicate operation handled silently without error');
    } finally {
      if (clientA) {
        await unrouteSuperSyncOps(clientA.page).catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario G.7: A future-schema operation blocks cursor advancement
   */
  test('Future-schema operation blocks until a compatible response is available', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let injectedResponses = 0;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Establish a shared cursor before creating the incompatible suffix.
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      const cursorBeforeBlock = await getSuperSyncCursor(clientB.page);
      expect(cursorBeforeBlock).not.toBeNull();

      const taskName = `Schema-${testRunId}`;
      const uploadedOpIds: string[] = [];
      await routeSuperSyncOps(clientA.page, async (route) => {
        if (route.request().method() === 'POST') {
          const upload = parseSuperSyncRequestBody<OperationUploadBody>(route.request());
          uploadedOpIds.push(...upload.ops.map((operation) => operation.id));
        }
        await route.continue();
      });
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await unrouteSuperSyncOps(clientA.page);
      expect(uploadedOpIds).toHaveLength(1);
      const blockerOpId = uploadedOpIds[0];

      // Tamper with the real operation wrapper on every retry. `schemaVersion`
      // is plaintext metadata beside the encrypted payload.
      await routeSuperSyncOps(clientB.page, async (route) => {
        if (route.request().method() === 'GET') {
          const response = await route.fetch();
          const body = (await response.json()) as OperationDownloadBody;
          const blocker = body.ops?.find(({ op }) => op?.id === blockerOpId);
          if (blocker?.op) {
            // 99 is within the transport contract (1..100) but newer than this
            // client's current schema, so it exercises the sync-layer blocker.
            blocker.op.schemaVersion = 99;
            injectedResponses++;
          }
          await route.fulfill({
            response,
            body: JSON.stringify(body),
          });
          return;
        }
        await route.continue();
      });

      // `triggerSync()` is a success-oriented helper and may throw as soon as
      // the expected error icon appears. Click directly and require the stable
      // blocked state before inspecting the cursor.
      await clientB.sync.syncBtn.click();
      await expect.poll(() => clientB!.sync.hasSyncError()).toBe(true);

      expect(injectedResponses).toBeGreaterThan(0);
      expect(await getSuperSyncCursor(clientB.page)).toBe(cursorBeforeBlock);
      await expect(
        clientB.page.locator(`task:has-text("${taskName}")`),
      ).not.toBeVisible();

      await unrouteSuperSyncOps(clientB.page);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      expect(await clientB.sync.hasSyncError()).toBe(false);
      expect(await getSuperSyncCursor(clientB.page)).not.toBe(cursorBeforeBlock);
    } finally {
      if (clientA) {
        await unrouteSuperSyncOps(clientA.page).catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) {
        await unrouteSuperSyncOps(clientB.page).catch(() => {});
        await closeClient(clientB);
      }
    }
  });

  /**
   * Scenario G.8: A mid-batch schema blocker applies only the valid prefix and keeps
   * the cursor before the blocker so the suffix can be retried after recovery.
   */
  test('Mid-batch schema blocker applies prefix and retries suffix from prior cursor', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let injectedResponses = 0;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      const cursorBeforeBlock = await getSuperSyncCursor(clientB.page);
      expect(cursorBeforeBlock).not.toBeNull();

      const taskNames = [
        `MigrationPrefix-${testRunId}`,
        `MigrationBlocker-${testRunId}`,
        `MigrationSuffix-${testRunId}`,
      ];
      const uploadedOpIds: string[] = [];
      await routeSuperSyncOps(clientA.page, async (route) => {
        if (route.request().method() === 'POST') {
          const upload = parseSuperSyncRequestBody<OperationUploadBody>(route.request());
          uploadedOpIds.push(...upload.ops.map((operation) => operation.id));
        }
        await route.continue();
      });
      for (const taskName of taskNames) {
        await clientA.workView.addTask(taskName);
      }
      await clientA.sync.syncAndWait();
      await unrouteSuperSyncOps(clientA.page);
      expect(uploadedOpIds).toHaveLength(3);
      const blockerOpId = uploadedOpIds[1];

      await routeSuperSyncOps(clientB.page, async (route) => {
        if (route.request().method() === 'GET') {
          const response = await route.fetch();
          const body = (await response.json()) as OperationDownloadBody;
          const blocker = body.ops?.find(({ op }) => op?.id === blockerOpId);
          if (blocker?.op) {
            // Use a real encrypted operation and change only its schema metadata,
            // preserving real server sequences on both sides of the blocker.
            blocker.op.schemaVersion = 99;
            injectedResponses++;
          }
          await route.fulfill({
            response,
            body: JSON.stringify(body),
          });
          return;
        }
        await route.continue();
      });

      await clientB.sync.syncBtn.click();
      await expect.poll(() => clientB!.sync.hasSyncError()).toBe(true);

      expect(injectedResponses).toBeGreaterThan(0);
      expect(await getSuperSyncCursor(clientB.page)).toBe(cursorBeforeBlock);
      await waitForTask(clientB.page, taskNames[0]);
      await expect(
        clientB.page.locator(`task:has-text("${taskNames[1]}")`),
      ).not.toBeVisible();
      await expect(
        clientB.page.locator(`task:has-text("${taskNames[2]}")`),
      ).not.toBeVisible();

      await unrouteSuperSyncOps(clientB.page);
      await clientB.sync.syncAndWait();
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
      }
      expect(await clientB.sync.hasSyncError()).toBe(false);
      expect(await getSuperSyncCursor(clientB.page)).not.toBe(cursorBeforeBlock);
    } finally {
      if (clientA) {
        await unrouteSuperSyncOps(clientA.page).catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) {
        await unrouteSuperSyncOps(clientB.page).catch(() => {});
        await closeClient(clientB);
      }
    }
  });
});
