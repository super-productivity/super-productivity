import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  archiveTask,
  hasTaskInWorklog,
  navigateToWorkView,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';
import {
  expectArchivedNotLive,
  expectNotInArchive,
  getLiveIds,
  getTaskIdByTitle,
  hasEverAppeared,
  watchNeverAppears,
} from '../../utils/audit-archive-helpers';

/** Task ids in e2e/fixtures/test-backup.json. */
const IMPORTED_TASK_IDS = ['active-task-1', 'active-task-subtask-1', 'active-task-2'];

/**
 * SuperSync sync-import conflict dialog with a server that holds archives.
 *
 * Client A archives a task and syncs; client B imports a backup and then
 * enables sync, which raises the sync-import conflict dialog. These tests cover
 * both dialog choices on SuperSync: "Use My Data" keeps the import (A's live and
 * archived task stay off B) and "Use Server Data" replaces it with the server
 * state, including A's archive.
 *
 * Scope note: the "Keep Local" archive-preservation fix (archives written in
 * hydrateFromRemoteSync after the conflict is resolved, not during download)
 * lives in the file-based adapter only and is unit-tested in
 * file-based-sync-adapter.service.spec.ts ("downloadOps" > "should NOT write
 * archive ..."). SuperSync never took that path, so these tests are not a
 * regression test for that fix; covering it end to end needs a WebDAV test.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-keep-local-archive-preservation.spec.ts
 */

test.describe('@supersync @archive Sync-import conflict dialog with server archives', () => {
  /**
   * Scenario: Keep local (Use My Data) works without validation errors
   *
   * This test verifies that when a client imports data and chooses "Use My Data"
   * during a sync conflict, no validation errors occur and A's archived task
   * stays off B (store and archive_young). See the scope note above: this is
   * not a regression test for the file-based archive fix.
   *
   * Setup:
   * - Client A creates and archives a task, syncs (server has A's data with archive)
   * - Client B imports backup (creates SYNC_IMPORT)
   *
   * Actions:
   * 1. Client B configures sync
   * 2. Conflict dialog appears
   * 3. Client B clicks "Use My Data"
   *
   * Verify:
   * - No validation errors
   * - Client B keeps imported data
   * - Sync works after "Use My Data"
   */
  test('Use My Data keeps the import and no server task when the server has archives', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Capture console errors
    const consoleErrors: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates and archives a task ============
      console.log('[KeepLocal] Phase 1: Client A creates archived data');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create and archive task on Client A
      const taskAName = `TaskA-Remote-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      await waitForTask(clientA.page, taskAName);
      const taskAId = await getTaskIdByTitle(clientA, taskAName);
      console.log('[KeepLocal] Client A created its task');

      // Archive the task
      await archiveTask(clientA, taskAName);
      console.log('[KeepLocal] Client A archived task');

      // Sync Client A (uploads archive to server)
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[KeepLocal] Client A synced with archived task');

      // ============ PHASE 2: Client B imports backup ============
      console.log('[KeepLocal] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      // Capture console errors on Client B
      clientB.page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Ignore known harmless errors
          if (
            !text.includes('ServiceWorker') &&
            !text.includes('NG05604') &&
            !text.includes('pf] Auto-fixing')
          ) {
            consoleErrors.push(text);
          }
        }
      });

      // Import backup (creates SYNC_IMPORT)
      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[KeepLocal] Client B imported backup');

      // Reload to ensure imported state is applied
      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientB.page.waitForLoadState('networkidle');

      // ============ PHASE 3: Client B syncs and chooses "Keep Local" ============
      console.log('[KeepLocal] Phase 3: Client B syncs and chooses Keep Local');

      // The imported fixture may be auto-repaired during import because it intentionally
      // exercises backup compatibility. This test is about validation errors caused by
      // the keep-local conflict path, so only collect errors from that point onward.
      consoleErrors.length = 0;

      // Positive control for the "never appears" watcher other specs rely on:
      // it must record this dialog, which is expected here.
      await watchNeverAppears(clientB.page, 'dialog-sync-import-conflict', 'conflict');
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 30000 });
      console.log('[KeepLocal] Conflict dialog appeared');

      // Click "Use My Data" (keep local/imported). The page object scopes the
      // native-confirm handler around the click; a raw click would hang on it.
      await clientB.sync.chooseSyncImportUseLocal();
      console.log('[KeepLocal] Clicked "Use My Data"');
      await expect(dialog).not.toBeVisible();
      await clientB.page.waitForTimeout(3000);

      // ============ PHASE 4: Verify no validation errors ============
      console.log('[KeepLocal] Phase 4: Checking for errors');

      // Filter for validation-related errors (the bug symptom)
      const validationErrors = consoleErrors.filter(
        (e) =>
          e.toLowerCase().includes('validation') ||
          e.toLowerCase().includes('entity') ||
          (e.toLowerCase().includes('not found') && e.toLowerCase().includes('project')),
      );

      if (validationErrors.length > 0) {
        console.log('[KeepLocal] Validation errors found:', validationErrors);
      }
      expect(validationErrors.length).toBe(0);
      console.log('[KeepLocal] ✓ No validation errors');

      // ============ PHASE 5: Verify imported data preserved ============
      console.log('[KeepLocal] Phase 5: Verifying imported data preserved');

      await navigateToWorkView(clientB);
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[KeepLocal] ✓ Imported data preserved');

      expect(await hasEverAppeared(clientB.page, 'conflict')).toBe(true);

      // Verify A's archived task is NOT on B. It is archived on A, so the work
      // view could never show it: read B's store and archive instead (the
      // imported task above and the archive entry are the positive anchors).
      expect(await getLiveIds(clientB, [taskAId])).toEqual([]);
      await expectNotInArchive(clientB, [taskAId], '[KeepLocal] Client B');
      console.log('[KeepLocal] ✓ Remote data NOT present');

      // Verify sync works after "Use My Data"
      await clientB.sync.syncAndWait();
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);
      console.log('[KeepLocal] ✓ Sync works after Keep Local');

      console.log('[KeepLocal] ✓ Keep local test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Use Server Data correctly downloads remote data including archives
   *
   * Control test to verify "Use Server Data" still works correctly.
   *
   * Setup:
   * - Client A creates and archives a task, syncs
   * - Client B imports backup
   *
   * Actions:
   * 1. Client B configures sync
   * 2. Conflict dialog appears
   * 3. Client B clicks "Use Server Data"
   *
   * Verify:
   * - Client B gets server data (including A's archived task)
   * - Imported data is replaced
   */
  test('Use Server Data replaces the import with server data including archives', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates and archives a task ============
      console.log('[UseServer] Phase 1: Client A creates and archives task');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskAName = `TaskA-Server-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      await waitForTask(clientA.page, taskAName);
      const taskAId = await getTaskIdByTitle(clientA, taskAName);
      await archiveTask(clientA, taskAName);
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[UseServer] Client A synced with archive');

      // ============ PHASE 2: Client B imports backup ============
      console.log('[UseServer] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientB.page.waitForLoadState('networkidle');
      // Positive anchor for the store absence check in phase 4: the fixture's
      // task ids are live on B after the import.
      const importedClient = clientB;
      await expect
        .poll(() => getLiveIds(importedClient, IMPORTED_TASK_IDS), { timeout: 15000 })
        .toEqual(IMPORTED_TASK_IDS);

      // ============ PHASE 3: Client B syncs and chooses Use Server Data ============
      console.log('[UseServer] Phase 3: Client B chooses Use Server Data');

      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 30000 });

      await clientB.sync.chooseSyncImportUseRemote();
      await expect(dialog).not.toBeVisible();

      // Wait for sync to complete
      await clientB.sync.waitForSyncToComplete({
        timeout: 30000,
        skipSpinnerCheck: true,
      });
      await clientB.page.waitForTimeout(2000);

      // ============ PHASE 4: Verify server data received ============
      console.log('[UseServer] Phase 4: Verifying server data received');

      // Client B should hold A's archived task in its archive, not live
      // (the worklog alone would also list a live task).
      await expectArchivedNotLive(clientB, [taskAId], '[UseServer] Client B');
      expect(await hasTaskInWorklog(clientB, taskAName)).toBe(true);
      console.log('[UseServer] ✓ Remote archive DOWNLOADED');

      // Client B should NOT have the imported tasks. The archive above anchors
      // that the server state was applied; read the store, not the work view.
      const serverDataClient = clientB;
      await expect
        .poll(() => getLiveIds(serverDataClient, IMPORTED_TASK_IDS), { timeout: 15000 })
        .toEqual([]);
      console.log('[UseServer] ✓ Imported data REPLACED');

      console.log('[UseServer] ✓ Use Server Data test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Use My Data keeps the imported state across a later sync
   *
   * After "Use My Data", a further sync must keep the imported state and must
   * not pull in A's archived task.
   *
   * Setup:
   * - Client A creates and archives a task, syncs
   * - Client B (fresh) imports backup (SYNC_IMPORT)
   *
   * Actions:
   * 1. Client B configures sync
   * 2. Conflict dialog appears
   * 3. Client B clicks "Use My Data"
   *
   * Verify:
   * - Sync completes without errors
   * - Imported task still present; A's task neither live nor in archive_young
   */
  test('Use My Data keeps the imported state across a later sync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates server state with archive ============
      console.log('[Preserve] Phase 1: Client A creates server state');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskAName = `ServerArchive-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      await waitForTask(clientA.page, taskAName);
      const taskAId = await getTaskIdByTitle(clientA, taskAName);
      await archiveTask(clientA, taskAName);
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[Preserve] Client A synced with archive');

      // ============ PHASE 2: Client B imports backup ============
      console.log('[Preserve] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientB.page.waitForLoadState('networkidle');

      // Verify imported state
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Preserve] Client B has imported data');

      // ============ PHASE 3: Client B syncs and keeps local ============
      console.log('[Preserve] Phase 3: Client B syncs and keeps local');

      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 30000 });

      await clientB.sync.chooseSyncImportUseLocal();
      await expect(dialog).not.toBeVisible();
      await clientB.page.waitForTimeout(3000);

      // ============ PHASE 4: Verify state is not corrupted ============
      console.log('[Preserve] Phase 4: Verifying state integrity');

      // Navigate around to trigger any lazy validation
      await navigateToWorkView(clientB);
      await clientB.page.goto('/#/tag/TODAY/history');
      await clientB.page.waitForLoadState('networkidle');
      await navigateToWorkView(clientB);

      // Imported data should be preserved
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Preserve] ✓ Imported state preserved');

      // Sync should work without errors
      await clientB.sync.syncAndWait();
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);
      console.log('[Preserve] ✓ Sync works, no corruption');

      // Server data should NOT be present: anchored on the imported task
      // (waitForTask above) and on B's archive entry existing.
      expect(await getLiveIds(clientB, [taskAId])).toEqual([]);
      await expectNotInArchive(clientB, [taskAId], '[Preserve] Client B');
      console.log('[Preserve] ✓ Server archive NOT present');

      console.log('[Preserve] ✓ State preservation test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
