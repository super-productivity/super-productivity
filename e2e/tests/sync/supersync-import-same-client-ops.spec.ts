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
import { expectTaskOnAllClients } from '../../utils/supersync-assertions';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync: Import Client's Own Post-Import Operations
 *
 * These tests verify that operations created by the SAME client that performed
 * a SYNC_IMPORT are correctly synced to other clients.
 *
 * BUG SCENARIO (vector clock pruning asymmetry):
 * 1. Client A creates SYNC_IMPORT with a 20-entry (MAX) vector clock
 * 2. Client A continues creating ops; over time, new clients join, pushing
 *    A's clock past MAX → server prunes entries
 * 3. A's ops have different pruned entries than A's frozen import clock
 * 4. Receiving client sees CONCURRENT (both have MAX entries, different keys)
 * 5. CONCURRENT comparison → ops incorrectly filtered
 *
 * FIX: Same-client counter comparison is definitive. If op.clientId matches
 * import.clientId and op's counter > import's counter, the op is post-import.
 *
 * NOTE: This E2E test can't trigger actual pruning (needs 21+ unique client IDs with MAX=20).
 * It verifies the end-to-end flow: import client's own post-import ops
 * must sync correctly to other clients. The unit tests verify the pruning-
 * specific detection logic.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-same-client-ops.spec.ts
 */

test.describe.configure({ mode: 'serial' });

test.describe('@supersync @pruning Import client post-import ops sync correctly', () => {
  /**
   * Scenario: Import client creates tasks after import — tasks sync to other client
   *
   * This is the core regression test. The import client (A) creates a SYNC_IMPORT,
   * then continues creating tasks. Those tasks must be received by client B.
   *
   * Without the same-client pruning fix, when vector clocks are at MAX size and
   * have diverged due to asymmetric pruning, these ops would be incorrectly
   * classified as CONCURRENT and filtered out on client B.
   */
  test('Import client own post-import tasks sync to other client', async ({
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
      console.log('[Same-Client Import] Phase 1: Setting up both clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync to establish vector clocks
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[Same-Client Import] Both clients synced initially');

      // ============ PHASE 2: Client A Imports Backup ============
      console.log('[Same-Client Import] Phase 2: Client A importing backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Same-Client Import] Client A imported backup');

      // Reload and re-enable sync
      await clientA.page.reload({ timeout: 60000 });
      await waitForAppReady(clientA.page, { ensureRoute: false });

      // Configure sync WITHOUT waiting for initial sync
      // (initial sync will show sync-import-conflict dialog since we have a local BackupImport)
      await clientA.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // Wait for either sync import conflict dialog OR sync completion
      // The dialog appears because download-first order finds server ops that conflict with our local import
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
        // Choose "Use My Data" to preserve the import (not "Use Server Data" which discards it)
        await clientA.sync.syncImportUseLocalBtn.click();
        await syncImportDialog.waitFor({ state: 'hidden', timeout: 5000 });
        // Wait for sync to complete after dialog handling
        await clientA.sync.syncCheckIcon.waitFor({ state: 'visible', timeout: 30000 });
      }

      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Same-Client Import] Client A showing imported data');

      // ============ PHASE 3: Client A syncs SYNC_IMPORT ============
      console.log('[Same-Client Import] Phase 3: Client A syncing SYNC_IMPORT');

      await clientA.sync.syncAndWait();
      console.log('[Same-Client Import] Client A synced (SYNC_IMPORT uploaded)');

      // ============ PHASE 4: Client A creates tasks AFTER import ============
      console.log(
        '[Same-Client Import] Phase 4: Import client (A) creating post-import tasks',
      );

      const taskA1 = `ImportClient-PostImport-Task1-${uniqueId}`;
      const taskA2 = `ImportClient-PostImport-Task2-${uniqueId}`;

      await clientA.workView.addTask(taskA1);
      await waitForTask(clientA.page, taskA1);
      console.log(`[Same-Client Import] Client A created: ${taskA1}`);

      await clientA.workView.addTask(taskA2);
      await waitForTask(clientA.page, taskA2);
      console.log(`[Same-Client Import] Client A created: ${taskA2}`);

      // ============ PHASE 5: Client A syncs post-import tasks ============
      console.log('[Same-Client Import] Phase 5: Client A syncing post-import tasks');

      await clientA.sync.syncAndWait();
      console.log('[Same-Client Import] Client A synced (post-import tasks uploaded)');

      // ============ PHASE 6: Client B syncs and receives everything ============
      console.log(
        '[Same-Client Import] Phase 6: Client B syncing (receives import + post-import tasks)',
      );

      await clientB.sync.syncAndWait();
      console.log('[Same-Client Import] Client B synced');

      // Navigate to work view
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // ============ PHASE 7: Verify both clients have all tasks ============
      console.log('[Same-Client Import] Phase 7: Verifying both clients have all tasks');

      // Client B should have the imported task
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Same-Client Import] Client B has imported task');

      // CRITICAL: Client B should have A's post-import tasks
      // This is where the bug would manifest — these tasks would be missing
      // on B if the same-client pruning fix didn't work
      await waitForTask(clientB.page, taskA1);
      await waitForTask(clientB.page, taskA2);
      console.log('[Same-Client Import] Client B has import client post-import tasks');

      // Verify on both clients
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      await expectTaskOnAllClients([clientA, clientB], taskA1);
      await expectTaskOnAllClients([clientA, clientB], taskA2);
      await expectTaskOnAllClients(
        [clientA, clientB],
        'E2E Import Test - Active Task With Subtask',
      );

      // No sync errors
      const errorSnackA = clientA.page.locator('simple-snack-bar.error');
      const errorSnackB = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnackA).not.toBeVisible({ timeout: 5000 });
      await expect(errorSnackB).not.toBeVisible({ timeout: 5000 });

      console.log('[Same-Client Import] Import client post-import ops test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple sync cycles — import client's ops survive across cycles
   *
   * Verifies that the import client can create tasks across multiple sync cycles
   * and they all appear on the other client. Each cycle increments the import
   * client's counter further from the import's counter, exercising the
   * same-client detection across multiple rounds.
   */
  test('Import client ops sync correctly across multiple cycles', async ({
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

      // Setup
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Import
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientA.page.reload({ timeout: 60000 });
      await waitForAppReady(clientA.page, { ensureRoute: false });

      // Configure sync WITHOUT waiting for initial sync (same dialog handling as test 1)
      await clientA.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const syncImportDialog2 = clientA.sync.syncImportConflictDialog;
      const syncResult2 = await Promise.race([
        syncImportDialog2
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'dialog' as const),
        clientA.sync.syncCheckIcon
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'complete' as const),
      ]);

      if (syncResult2 === 'dialog') {
        await clientA.sync.syncImportUseLocalBtn.click();
        await syncImportDialog2.waitFor({ state: 'hidden', timeout: 5000 });
        await clientA.sync.syncCheckIcon.waitFor({ state: 'visible', timeout: 30000 });
      }

      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      await clientA.sync.syncAndWait();
      console.log('[Multi-Cycle Same-Client] SYNC_IMPORT uploaded');

      // Client B receives import
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      // Cycle 1: A creates task, syncs, B receives
      const taskA1 = `Cycle1-A-${uniqueId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskA1);
      console.log(`[Multi-Cycle Same-Client] Cycle 1: B received ${taskA1}`);

      // Cycle 2: B creates task, syncs, A receives, A creates task
      const taskB1 = `Cycle2-B-${uniqueId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, taskB1);

      const taskA2 = `Cycle2-A-${uniqueId}`;
      await clientA.workView.addTask(taskA2);
      await clientA.sync.syncAndWait();
      console.log(`[Multi-Cycle Same-Client] Cycle 2: A created ${taskA2}`);

      // Cycle 3: B receives A's task, A creates another
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskA2);

      const taskA3 = `Cycle3-A-${uniqueId}`;
      await clientA.workView.addTask(taskA3);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskA3);
      console.log(`[Multi-Cycle Same-Client] Cycle 3: B received ${taskA3}`);

      // Final verification
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      await expectTaskOnAllClients([clientA, clientB], taskA1);
      await expectTaskOnAllClients([clientA, clientB], taskB1);
      await expectTaskOnAllClients([clientA, clientB], taskA2);
      await expectTaskOnAllClients([clientA, clientB], taskA3);

      console.log('[Multi-Cycle Same-Client] Multi-cycle test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
