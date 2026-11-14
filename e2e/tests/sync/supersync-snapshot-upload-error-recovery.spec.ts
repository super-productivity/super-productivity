import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  isFullStateOpType,
  SUPERSYNC_BASE_URL,
  SUPERSYNC_SNAPSHOT_ROUTE,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { readLocalOpEntries } from '../../utils/audit-error-paths-helpers';

/**
 * Wipes the account's sync data and keeps the account, like a server restored
 * without its sync tables. The next sync of a synced client sees the gap and
 * seeds the server again with a full-state snapshot (SERVER_MIGRATION).
 */
const wipeUserSyncData = async (token: string): Promise<void> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/data`, {
    method: 'DELETE',
    headers: {
      ['Content-Type']: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '{}',
  });
  if (!response.ok) {
    throw new Error(`Failed to wipe sync data: HTTP ${response.status}`);
  }
};

/** Replies that say nothing about the uploaded snapshot itself. */
const FAULTS = [
  {
    name: 'a 401 for the stored token',
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Token expired' }),
  },
  {
    name: 'a 413 from a reverse proxy',
    status: 413,
    contentType: 'text/html',
    body: '<html><body><h1>413 Request Entity Too Large</h1></body></html>',
  },
] as const;

/**
 * A full-state upload (POST /api/sync/snapshot) that fails for a reason
 * unrelated to the snapshot was classified as the server rejecting it. A
 * rejected full-state op blocks every later upload until a newer one exists,
 * and a rejected server-migration snapshot is never created again, so sync
 * stopped uploading for good after one environmental failure.
 *
 * File-sync counterpart: webdav-snapshot-upload-error-recovery-11344.spec.ts
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-snapshot-upload-error-recovery.spec.ts
 */
test.describe('@supersync a failed snapshot upload does not stop SuperSync for good', () => {
  for (const fault of FAULTS) {
    test(`uploads the snapshot on the next sync after ${fault.name}`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(240000);
      const appUrl = baseURL || 'http://localhost:4242';
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      try {
        const user = await createTestUser(testRunId);
        const syncConfig = getSuperSyncConfig(user);

        clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
        await clientA.sync.setupSuperSync(syncConfig);
        const beforeFault = `Before-fault-${testRunId}`;
        await clientA.workView.addTask(beforeFault);
        await clientA.sync.syncAndWait();

        let failedSnapshotUploads = 0;
        await clientA.page.route(SUPERSYNC_SNAPSHOT_ROUTE, async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          failedSnapshotUploads++;
          await route.fulfill({
            status: fault.status,
            contentType: fault.contentType,
            body: fault.body,
          });
        });

        // The server loses the account's sync data; A has to seed it again.
        await wipeUserSyncData(user.token);

        // The failed upload is reported, not hidden.
        await expect(clientA.sync.syncAndWait()).rejects.toThrow(/error state/);
        expect(failedSnapshotUploads).toBeGreaterThan(0);
        await expect(clientA.sync.syncErrorIcon).toBeVisible();

        // The snapshot is still waiting to be uploaded. Soft, so that a failure
        // here still runs into the user-visible outcome below.
        const fullStateOps = (await readLocalOpEntries(clientA.page)).filter(
          (op) => op.source === 'local' && isFullStateOpType(op.opType) && !op.isSynced,
        );
        expect.soft(fullStateOps.map((op) => op.isRejected)).toEqual([false]);

        // The fault is gone. Work done meanwhile must reach the server too.
        await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE);
        const whileFailing = `While-failing-${testRunId}`;
        await clientA.workView.addTask(whileFailing);
        await clientA.sync.syncAndWait();
        await expect(clientA.sync.syncErrorIcon).toBeHidden();

        // A second device joining the account gets both tasks.
        clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
        await clientB.sync.setupSuperSync(syncConfig);
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, beforeFault, 30000);
        await waitForTask(clientB.page, whileFailing, 30000);

        // A's later uploads are not blocked either.
        const afterRecovery = `After-recovery-${testRunId}`;
        await clientA.workView.addTask(afterRecovery);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, afterRecovery, 30000);
      } finally {
        if (clientA) {
          await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE).catch(() => {});
          await closeClient(clientA);
        }
        if (clientB) await closeClient(clientB);
      }
    });
  }
});
