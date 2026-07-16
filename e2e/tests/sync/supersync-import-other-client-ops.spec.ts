import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  parseSuperSyncRequestBody,
  routeSuperSyncOps,
  SUPERSYNC_BASE_URL,
  unrouteSuperSyncOps,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { expectTaskOnAllClients } from '../../utils/supersync-assertions';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync: Other Client's Post-Import Operations Across Clock Pruning
 *
 * These tests verify that operations created by a DIFFERENT client than the one
 * that performed a SYNC_IMPORT are correctly synced back to the importing client.
 *
 * PRUNING SCENARIO:
 * 1. Client B has accumulated a large vector clock from long history (many old devices)
 * 2. Client A does SYNC_IMPORT with a fresh clock
 * 3. Client B receives the SYNC_IMPORT — mergeRemoteOpClocks() MERGES the import's
 *    fresh clock into B's old accumulated clock instead of REPLACING it
 * 4. B's clock now has 21+ entries (old entries + import's entry)
 * 5. B creates new ops — their clocks carry all 21+ entries
 * 6. Server prunes B's ops to MAX=20 while retaining the active import author
 * 7. Client A receives B's pruned ops and applies them after its import
 *
 * TEST SETUP: We augment Client B's real upload with 25 old-device clock entries.
 * This models a long-lived client and deliberately crosses the server's
 * MAX_VECTOR_CLOCK_SIZE=20 boundary without manufacturing operations or responses.
 * The historical counters deliberately outrank the import author. This proves
 * the server preserves the active full-state boundary rather than merely keeping
 * whichever entries have the highest counters.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-other-client-ops.spec.ts
 */

test.describe.configure({ mode: 'serial' });

interface StoredServerOperation {
  id: string;
  clientId: string;
  vectorClock: Record<string, number>;
}

interface MutableUploadOperation {
  id: string;
  vectorClock: Record<string, number>;
}

interface MutableUploadBody {
  ops: MutableUploadOperation[];
}

const getStoredOperations = async (
  userId: number,
  opType: string,
  limit: number,
): Promise<StoredServerOperation[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?opType=${opType}&limit=${limit}`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect stored operation clocks: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { ops: StoredServerOperation[] };
  return body.ops;
};

test.describe('@supersync @pruning Other client post-import ops sync correctly', () => {
  /**
   * Scenario: Client B creates tasks after receiving Client A's SYNC_IMPORT
   * with an oversized vector clock — the server should prune it and the tasks
   * should still sync to Client A.
   */
  test('Other client post-import tasks with bloated clock sync to importing client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup Both Clients ============
      console.log('[Other-Client Import] Phase 1: Setting up both clients');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync to establish vector clocks
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[Other-Client Import] Both clients synced initially');

      // ============ PHASE 2: Create some initial history ============
      console.log('[Other-Client Import] Phase 2: Creating initial history');

      const historyTask = `History-Task-${uniqueId}`;
      await clientA.workView.addTask(historyTask);
      await waitForTask(clientA.page, historyTask);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, historyTask);
      console.log('[Other-Client Import] Initial history synced');

      // ============ PHASE 3: Client A imports backup ============
      console.log('[Other-Client Import] Phase 3: Client A importing backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Other-Client Import] Client A imported backup');

      // Close and re-open page to pick up imported data with fresh Angular services.
      // Using page.reload() can hang when active sync connections prevent navigation.
      await clientA.page.close();
      clientA.page = await clientA.context.newPage();
      await clientA.page.goto('/');
      clientA.workView = new WorkViewPage(clientA.page, `A-${testRunId}`);
      clientA.sync = new SuperSyncPage(clientA.page);
      await waitForAppReady(clientA.page, { ensureRoute: false });

      // Configure sync WITHOUT waiting for initial sync
      // (initial sync will show sync-import-conflict dialog since we have a local BackupImport)
      await clientA.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // Wait for either sync import conflict dialog OR sync completion
      const syncImportDialog = clientA.sync.syncImportConflictDialog;
      const syncResult = await Promise.race([
        syncImportDialog
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'dialog' as const),
        clientA.sync.syncCheckIcon
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'complete' as const),
      ]);

      if (syncResult === 'dialog') {
        // Choose "Use My Data" to preserve the import
        await clientA.sync.syncImportUseLocalBtn.click();
        await syncImportDialog.waitFor({ state: 'hidden', timeout: 5000 });
        await clientA.sync.syncCheckIcon.waitFor({ state: 'visible', timeout: 30000 });
      }

      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Other-Client Import] Client A showing imported data');

      // ============ PHASE 4: Client A syncs SYNC_IMPORT ============
      console.log('[Other-Client Import] Phase 4: Client A syncing SYNC_IMPORT');

      await clientA.sync.syncAndWait();
      console.log('[Other-Client Import] Client A synced (SYNC_IMPORT uploaded)');

      // ============ PHASE 5: Client B syncs and receives SYNC_IMPORT ============
      console.log(
        '[Other-Client Import] Phase 5: Client B syncing (receives SYNC_IMPORT)',
      );

      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Other-Client Import] Client B received SYNC_IMPORT');

      const [fullStateOperation] = await getStoredOperations(
        user.userId,
        'SYNC_IMPORT',
        1,
      );
      expect(fullStateOperation).toBeDefined();
      const fullStateAuthor = fullStateOperation.clientId;

      // ============ PHASE 6: Inflate Client B's real upload clock ============
      console.log(
        '[Other-Client Import] Phase 6: Installing oversized-clock upload route',
      );

      const uploadedClockSizes: number[] = [];
      const uploadedOperationIds: string[] = [];
      await routeSuperSyncOps(clientB.page, async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }

        const body = parseSuperSyncRequestBody<MutableUploadBody>(route.request());
        for (const operation of body.ops) {
          for (let i = 0; i < 25; i++) {
            operation.vectorClock[`old-device-${String(i).padStart(5, '0')}`] = 100 + i;
          }
          uploadedClockSizes.push(Object.keys(operation.vectorClock).length);
          uploadedOperationIds.push(operation.id);
        }

        // Send the modified body as plain JSON even when the original browser
        // request was gzip encoded.
        const headers = { ...route.request().headers() };
        delete headers['content-encoding'];
        delete headers['content-transfer-encoding'];
        delete headers['content-length'];
        const response = await route.fetch({
          headers,
          postData: JSON.stringify(body),
        });
        await route.fulfill({ response });
      });

      // ============ PHASE 7: Client B creates new tasks ============
      // These ops will carry B's bloated vector clock with old entries
      console.log('[Other-Client Import] Phase 7: Client B creating post-import tasks');

      const taskB1 = `OtherClient-PostImport-Task1-${uniqueId}`;
      const taskB2 = `OtherClient-PostImport-Task2-${uniqueId}`;

      await clientB.workView.addTask(taskB1);
      await waitForTask(clientB.page, taskB1);
      console.log(`[Other-Client Import] Client B created: ${taskB1}`);

      await clientB.workView.addTask(taskB2);
      await waitForTask(clientB.page, taskB2);
      console.log(`[Other-Client Import] Client B created: ${taskB2}`);

      // ============ PHASE 8: Client B syncs (uploads ops with post-import clock) ============
      console.log(
        '[Other-Client Import] Phase 8: Client B syncing (uploads ops with bloated clock)',
      );

      await clientB.sync.syncAndWait();
      console.log('[Other-Client Import] Client B synced (ops uploaded)');

      expect(uploadedClockSizes).toHaveLength(2);
      expect(uploadedClockSizes.every((size) => size > 20)).toBe(true);
      await unrouteSuperSyncOps(clientB.page);

      const storedCreateOperations = (
        await getStoredOperations(user.userId, 'CRT', 10)
      ).filter((operation) => uploadedOperationIds.includes(operation.id));
      expect(storedCreateOperations).toHaveLength(2);
      for (const operation of storedCreateOperations) {
        expect(Object.keys(operation.vectorClock)).toHaveLength(20);
        expect(operation.vectorClock[fullStateAuthor]).toBeDefined();
      }

      // ============ PHASE 9: Client A syncs (downloads B's pruned ops) ============
      console.log('[Other-Client Import] Phase 9: Client A syncing (downloads B ops)');

      await clientA.sync.syncAndWait();
      console.log('[Other-Client Import] Client A synced');

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // ============ PHASE 10: Verify Client A sees B's tasks ============
      console.log(
        '[Other-Client Import] Phase 10: Verifying Client A has B post-import tasks',
      );

      // Both clients should have the imported task
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      // Client A should have B's post-import tasks after server-side pruning.
      await waitForTask(clientA.page, taskB1);
      await waitForTask(clientA.page, taskB2);
      console.log('[Other-Client Import] Client A has B post-import tasks');

      // Verify on both clients
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      await expectTaskOnAllClients([clientA, clientB], taskB1);
      await expectTaskOnAllClients([clientA, clientB], taskB2);
      await expectTaskOnAllClients(
        [clientA, clientB],
        'E2E Import Test - Active Task With Subtask',
      );

      // No sync errors
      const errorSnackA = clientA.page.locator('simple-snack-bar.error');
      const errorSnackB = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnackA).not.toBeVisible({ timeout: 5000 });
      await expect(errorSnackB).not.toBeVisible({ timeout: 5000 });

      console.log('[Other-Client Import] Other client post-import ops test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) {
        await unrouteSuperSyncOps(clientB.page).catch(() => {});
        await closeClient(clientB);
      }
    }
  });
});
