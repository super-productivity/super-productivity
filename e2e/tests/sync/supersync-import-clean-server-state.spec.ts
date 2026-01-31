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

/**
 * SuperSync Import Clean Server State E2E Tests
 *
 * These tests verify the bug fixes for SYNC_IMPORT server handling:
 *
 * 1. Server should delete existing data before accepting new SYNC_IMPORT
 * 2. Old full-state ops should be cleared when new SYNC_IMPORT is applied
 *
 * Without these fixes, clients joining after a SYNC_IMPORT could receive
 * superseded operations that were concurrent with but superseded by the import.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-clean-server-state.spec.ts
 */

test.describe('@supersync @import SYNC_IMPORT Clean Server State', () => {
  /**
   * Scenario: SYNC_IMPORT clears server state for fresh client joining later
   *
   * This test verifies that when a client sends a SYNC_IMPORT to the server,
   * any existing server data is cleared so that new clients only receive
   * the imported state.
   *
   * Setup:
   * - Client A creates old data (Task-OLD), archives it, syncs
   *
   * Actions:
   * 1. Client A imports a backup (triggers SYNC_IMPORT with different data)
   * 2. Client A syncs (uploads SYNC_IMPORT)
   * 3. Client B (fresh) joins and syncs
   *
   * Verify:
   * - Client B has ONLY the imported data
   * - Client B does NOT have the old data (Task-OLD)
   * - Client B does NOT have old archived tasks in worklog
   */
  test('SYNC_IMPORT clears server state for fresh client joining later', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates old data ============
      console.log('[CleanState] Phase 1: Client A creates old data');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create an old task
      const taskOld = `Task-OLD-${uniqueId}`;
      await clientA.workView.addTask(taskOld);
      await waitForTask(clientA.page, taskOld);
      console.log(`[CleanState] Client A created: ${taskOld}`);

      // Archive the old task
      await archiveTask(clientA, taskOld);
      await navigateToWorkView(clientA);
      console.log('[CleanState] Task archived');

      // Sync old data to server
      await clientA.sync.syncAndWait();
      console.log('[CleanState] Old data synced to server');

      // Create another active task (not archived)
      const taskOldActive = `TaskOldActive-${uniqueId}`;
      await clientA.workView.addTask(taskOldActive);
      await clientA.sync.syncAndWait();
      console.log(`[CleanState] Old active task synced: ${taskOldActive}`);

      // ============ PHASE 2: Client A imports backup (SYNC_IMPORT) ============
      console.log('[CleanState] Phase 2: Client A imports backup');

      // Navigate to import page
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import backup (this creates a SYNC_IMPORT)
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[CleanState] Backup imported');

      // Reload page to ensure imported state is applied
      await clientA.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientA.page.waitForLoadState('networkidle');

      // ============ PHASE 3: Client A syncs (uploads SYNC_IMPORT) ============
      console.log('[CleanState] Phase 3: Client A syncs SYNC_IMPORT');

      // Sync - this uploads the SYNC_IMPORT which should clear old server data
      await clientA.sync.syncAndWait();
      console.log('[CleanState] SYNC_IMPORT synced');

      // ============ PHASE 4: Fresh Client B joins ============
      console.log('[CleanState] Phase 4: Fresh Client B joins');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      console.log('[CleanState] Client B synced');

      // ============ PHASE 5: Verify Client B only has imported data ============
      console.log('[CleanState] Phase 5: Verifying Client B state');

      // Client B should have the imported task from backup
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[CleanState] ✓ Client B has imported task');

      // Client B should NOT have the old task (was superseded by import)
      const hasOldTask = await clientB.page
        .locator(`task:has-text("${taskOld}")`)
        .isVisible()
        .catch(() => false);
      expect(hasOldTask).toBe(false);
      console.log('[CleanState] ✓ Client B does NOT have old task');

      // Client B should NOT have the old active task
      const hasOldActiveTask = await clientB.page
        .locator(`task:has-text("${taskOldActive}")`)
        .isVisible()
        .catch(() => false);
      expect(hasOldActiveTask).toBe(false);
      console.log('[CleanState] ✓ Client B does NOT have old active task');

      // Client B should NOT have old archived task in worklog
      const hasOldInWorklog = await hasTaskInWorklog(clientB, taskOld);
      expect(hasOldInWorklog).toBe(false);
      console.log('[CleanState] ✓ Client B does NOT have old archived task in worklog');

      // Verify no sync errors
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);

      console.log('[CleanState] ✓ SYNC_IMPORT clean server state test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple SYNC_IMPORTs overwrite each other cleanly
   *
   * Tests that doing multiple imports in sequence properly clears the
   * previous import's data.
   *
   * Setup:
   * - Client A imports Backup-1 (creates SYNC_IMPORT-1)
   * - Client B verifies Backup-1 data
   *
   * Actions:
   * 1. Client A imports different data (Backup-2, creates SYNC_IMPORT-2)
   * 2. Client A syncs
   * 3. Client C (fresh) joins
   *
   * Verify:
   * - Client C has ONLY Backup-2 data
   * - Client C does NOT have Backup-1 remnants
   */
  test('Multiple SYNC_IMPORTs overwrite each other cleanly', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A imports first backup ============
      console.log('[MultiImport] Phase 1: Client A imports first backup');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);

      // Import first backup
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientA.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientA.page.waitForLoadState('networkidle');

      // Setup sync and sync (SYNC_IMPORT-1)
      await clientA.sync.setupSuperSync(syncConfig);
      console.log('[MultiImport] First import synced');

      // Verify first import data
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      // ============ PHASE 2: Create unique task to identify first import ============
      console.log('[MultiImport] Phase 2: Creating marker task');

      const markerTask = `Import1-Marker-${uniqueId}`;
      await clientA.workView.addTask(markerTask);
      await clientA.sync.syncAndWait();
      console.log(`[MultiImport] Created marker: ${markerTask}`);

      // ============ PHASE 3: Client A does second import ============
      console.log('[MultiImport] Phase 3: Client A does second import');

      // Import same backup again (simulating a second import)
      // The key is that this creates a NEW SYNC_IMPORT that should supersede the first
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(backupPath);

      await clientA.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientA.page.waitForLoadState('networkidle');

      // Sync the new import (SYNC_IMPORT-2)
      await clientA.sync.syncAndWait();
      console.log('[MultiImport] Second import synced');

      // ============ PHASE 4: Fresh Client B joins ============
      console.log('[MultiImport] Phase 4: Fresh Client B joins');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      console.log('[MultiImport] Client B synced');

      // ============ PHASE 5: Verify Client B only has second import data ============
      console.log('[MultiImport] Phase 5: Verifying Client B state');

      // Client B should have the imported task
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[MultiImport] ✓ Client B has imported task');

      // Client B should NOT have the marker task from first import
      // (second import superseded it)
      const hasMarker = await clientB.page
        .locator(`task:has-text("${markerTask}")`)
        .isVisible()
        .catch(() => false);
      expect(hasMarker).toBe(false);
      console.log('[MultiImport] ✓ Client B does NOT have marker from first import');

      // Verify no sync errors
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);

      console.log('[MultiImport] ✓ Multiple SYNC_IMPORTs test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Server properly handles SYNC_IMPORT with archived data
   *
   * Tests that SYNC_IMPORT properly transfers archived data to new clients,
   * while clearing any old archived data on the server.
   *
   * Setup:
   * - Client A has OLD archived task synced to server
   *
   * Actions:
   * 1. Client A imports backup (SYNC_IMPORT)
   * 2. Backup doesn't have OLD archived task
   * 3. Client B joins
   *
   * Verify:
   * - Client B does NOT have OLD archived task
   */
  test('SYNC_IMPORT properly clears old archived data from server', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates and archives old data ============
      console.log('[ArchiveClean] Phase 1: Client A creates archived data');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create and archive an old task
      const oldArchived = `OldArchived-${uniqueId}`;
      await clientA.workView.addTask(oldArchived);
      await waitForTask(clientA.page, oldArchived);
      await archiveTask(clientA, oldArchived);
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log(`[ArchiveClean] Old archived task synced: ${oldArchived}`);

      // ============ PHASE 2: Client A imports backup ============
      console.log('[ArchiveClean] Phase 2: Client A imports backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientA.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientA.page.waitForLoadState('networkidle');
      await clientA.sync.syncAndWait();
      console.log('[ArchiveClean] Backup imported and synced');

      // ============ PHASE 3: Fresh Client B joins ============
      console.log('[ArchiveClean] Phase 3: Fresh Client B joins');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      console.log('[ArchiveClean] Client B synced');

      // ============ PHASE 4: Verify old archive is gone ============
      console.log('[ArchiveClean] Phase 4: Verifying old archive is cleared');

      // Client B should NOT have the old archived task in worklog
      const hasOldArchived = await hasTaskInWorklog(clientB, oldArchived);
      expect(hasOldArchived).toBe(false);
      console.log('[ArchiveClean] ✓ Old archived task NOT in Client B worklog');

      // Verify no sync errors
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);

      console.log('[ArchiveClean] ✓ Archive cleanup test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
