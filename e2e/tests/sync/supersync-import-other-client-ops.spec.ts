import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { expectTaskOnAllClients } from '../../utils/supersync-assertions';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync: Other Client's Post-Import Operations (Vector Clock Bloat Bug)
 *
 * These tests verify that operations created by a DIFFERENT client than the one
 * that performed a SYNC_IMPORT are correctly synced back to the importing client.
 *
 * BUG SCENARIO (vector clock merge-vs-replace):
 * 1. Client B has accumulated a large vector clock from long history (many old devices)
 * 2. Client A does SYNC_IMPORT with a fresh clock
 * 3. Client B receives the SYNC_IMPORT — mergeRemoteOpClocks() MERGES the import's
 *    fresh clock into B's old accumulated clock instead of REPLACING it
 * 4. B's clock now has 13+ entries (old entries + import's entry)
 * 5. B creates new ops — their clocks carry all 13+ entries
 * 6. Server prunes B's ops to MAX=20, dropping import's entry (lowest counter)
 * 7. Client A receives B's pruned ops — compareVectorClocks returns CONCURRENT
 *    (B has old entries A doesn't know, A has import entry B lost to pruning)
 * 8. SyncImportFilterService filters B's ops as "concurrent with import"
 * 9. Client A never sees Client B's new tasks
 *
 * IMPORTANT LIMITATION:
 * With only 2 fresh E2E clients, vector clocks have ~3 entries — well below the
 * MAX=20 pruning threshold. Without pruning, compareVectorClocks returns GREATER_THAN
 * (correct!) even with the merge bug. The bug ONLY manifests when accumulated entries
 * exceed MAX and pruning removes the import entry.
 *
 * SOLUTION: After Client B receives the SYNC_IMPORT, we inject 12 extra old-device
 * entries into Client B's IndexedDB vector_clock store via page.evaluate(). This
 * simulates real-world accumulated history from many past devices.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-other-client-ops.spec.ts
 */

test.describe.configure({ mode: 'serial' });

test.describe('@supersync @pruning Other client post-import ops sync correctly', () => {
  /**
   * Scenario: Client B creates tasks after receiving Client A's SYNC_IMPORT
   * with a bloated vector clock — tasks should sync to Client A
   *
   * This test injects old vector clock entries into Client B's IndexedDB to simulate
   * real-world accumulated history. After pruning, the import's entry gets dropped,
   * causing Client A to incorrectly filter Client B's ops as CONCURRENT.
   */
  test('Other client post-import tasks with bloated clock sync to importing client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup Both Clients ============
      console.log('[Other-Client Import] Phase 1: Setting up both clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
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

      // ============ PHASE 6: Inject bloated vector clock into Client B ============
      // This simulates real-world accumulated history from many old devices.
      // Without this injection, the vector clock only has ~3 entries (well below MAX=20)
      // and pruning never happens, so the bug doesn't manifest.
      console.log(
        '[Other-Client Import] Phase 6: Injecting old device entries into Client B vector clock',
      );

      await clientB.page.evaluate(async () => {
        const DB_NAME = 'SUP_OPS';
        const VECTOR_CLOCK_STORE = 'vector_clock';
        const SINGLETON_KEY = 'current';

        // Open the database
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(DB_NAME);
          request.onsuccess = (): void => resolve(request.result);
          request.onerror = (): void => reject(request.error);
        });

        // Read current vector clock entry
        const currentEntry = await new Promise<any>((resolve, reject) => {
          const tx = db.transaction(VECTOR_CLOCK_STORE, 'readonly');
          const store = tx.objectStore(VECTOR_CLOCK_STORE);
          const request = store.get(SINGLETON_KEY);
          request.onsuccess = (): void => resolve(request.result);
          request.onerror = (): void => reject(request.error);
        });

        const existingClock = currentEntry?.clock ?? {};
        console.log(
          '[Injected] Existing clock entries:',
          Object.keys(existingClock).length,
        );

        // Add 12 old-device entries with high counters to simulate long history
        // These represent old devices that were once part of the sync network
        const bloatedClock = { ...existingClock };
        for (let i = 0; i < 12; i++) {
          const deviceId = `old-device-${String(i).padStart(5, '0')}`;
          bloatedClock[deviceId] = 100 + i;
        }

        console.log(
          '[Injected] Bloated clock entries:',
          Object.keys(bloatedClock).length,
        );

        // Write back the bloated vector clock
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(VECTOR_CLOCK_STORE, 'readwrite');
          const store = tx.objectStore(VECTOR_CLOCK_STORE);
          const entry = {
            ...currentEntry,
            clock: bloatedClock,
            lastUpdate: Date.now(),
          };
          const request = store.put(entry, SINGLETON_KEY);
          request.onsuccess = (): void => resolve();
          request.onerror = (): void => reject(request.error);
        });

        db.close();
        console.log('[Injected] Vector clock bloated successfully');
      });

      console.log(
        '[Other-Client Import] Client B vector clock bloated with 12 old device entries',
      );

      // ============ PHASE 6b: Reload Client B to pick up injected clock ============
      // CRITICAL: OperationLogStoreService has an in-memory _vectorClockCache that
      // bypasses IndexedDB reads. Without reloading, the injected entries never reach
      // the ops' vector clocks — getVectorClock() returns the stale cached value,
      // and appendWithVectorClockUpdate() overwrites the injected IDB data.
      // Reloading destroys the Angular service, forcing a fresh read from IndexedDB.
      console.log(
        '[Other-Client Import] Phase 6b: Reloading Client B to pick up injected clock',
      );

      // Close the page and open a new one in the same context (preserves IndexedDB).
      // Using page.reload() or page.goto() can hang when active sync connections
      // prevent navigation lifecycle events from completing.
      await clientB.page.close();
      clientB.page = await clientB.context.newPage();
      await clientB.page.goto('/');
      await waitForAppReady(clientB.page, { ensureRoute: false });
      // Re-create page objects for the new page
      clientB.workView = new WorkViewPage(clientB.page, `B-${testRunId}`);
      clientB.sync = new SuperSyncPage(clientB.page);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Other-Client Import] Client B reloaded with bloated clock');

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
      // Validates that B's ops (with clock from REPLACE, not MERGE) sync correctly
      console.log(
        '[Other-Client Import] Phase 8: Client B syncing (uploads ops with bloated clock)',
      );

      await clientB.sync.syncAndWait();
      console.log('[Other-Client Import] Client B synced (ops uploaded)');

      // ============ PHASE 9: Client A syncs (downloads B's pruned ops) ============
      console.log('[Other-Client Import] Phase 9: Client A syncing (downloads B ops)');

      await clientA.sync.syncAndWait();
      console.log('[Other-Client Import] Client A synced');

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // ============ PHASE 10: Verify Client A sees B's tasks ============
      // BUG: Client A filters B's ops as CONCURRENT with the import
      // because B's pruned op clocks are missing the import's entry
      console.log(
        '[Other-Client Import] Phase 10: Verifying Client A has B post-import tasks',
      );

      // Both clients should have the imported task
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      // CRITICAL: Client A should have B's post-import tasks
      // This is where the bug manifests — these tasks are missing on A
      // because SyncImportFilterService filters them as CONCURRENT
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
      if (clientB) await closeClient(clientB);
    }
  });
});
