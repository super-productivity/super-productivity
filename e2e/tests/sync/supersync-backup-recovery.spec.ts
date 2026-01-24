import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * SuperSync Backup Recovery E2E Tests
 *
 * These tests verify that backup imports use OpType.BackupImport (reason='recovery')
 * which allows imports even when a SYNC_IMPORT already exists on the server.
 *
 * Bug fixed: backup.service.ts was using OpType.SyncImport (reason='initial') which
 * caused 409 SYNC_IMPORT_EXISTS errors when trying to recover via backup import.
 *
 * Server behavior:
 * - reason='initial' → 409 if SYNC_IMPORT exists (prevents duplicate initial snapshots)
 * - reason='recovery' → Allowed (user-initiated recovery should always work)
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-backup-recovery.spec.ts
 */

/**
 * Helper to mark a task as done using keyboard shortcut
 */
const markTaskDone = async (
  page: SimulatedE2EClient['page'],
  taskName: string,
): Promise<void> => {
  const task = page.locator(`task:not(.ng-animating):has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });

  await task.focus();
  await page.waitForTimeout(100);
  await task.press('d');

  await expect(task).toHaveClass(/isDone/, { timeout: 10000 });
};

/**
 * Helper to archive done tasks via Daily Summary
 */
const archiveDoneTasks = async (page: SimulatedE2EClient['page']): Promise<void> => {
  const finishDayBtn = page.locator('.e2e-finish-day');
  await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
  await finishDayBtn.click();

  await page.waitForURL(/daily-summary/);

  const saveAndGoHomeBtn = page.locator(
    'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
  );
  await saveAndGoHomeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveAndGoHomeBtn.click();

  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/**
 * Helper to check worklog for archived task entries
 */
const checkWorklogForArchivedTasks = async (
  page: SimulatedE2EClient['page'],
): Promise<number> => {
  await page.goto('/#/tag/TODAY/worklog');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Try to expand week rows to see task entries
  const weekRows = page.locator('.week-row');
  const weekCount = await weekRows.count();
  for (let i = 0; i < Math.min(weekCount, 3); i++) {
    const row = weekRows.nth(i);
    if (await row.isVisible()) {
      await row.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  // Count task entries in worklog
  const taskEntries = await page
    .locator('.task-summary-table .task-title, .worklog-task, worklog-task')
    .count()
    .catch(() => 0);

  return taskEntries;
};

/**
 * Helper to export backup from the app by reading IndexedDB directly
 */
const exportBackup = async (page: SimulatedE2EClient['page']): Promise<string> => {
  // Get backup data directly from IndexedDB (more reliable than Angular DI)
  const backupData = await page.evaluate(async () => {
    // Helper to get value from IndexedDB store
    const getFromStore = <T>(
      database: IDBDatabase,
      storeName: string,
      key: string,
    ): Promise<T | undefined> => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    };

    // Open the SUP_OPS database (stores state cache and archives)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Get state cache from state_cache store
    const stateCacheEntry = await getFromStore<{
      id: string;
      state: Record<string, unknown>;
    }>(db, 'state_cache', 'current');

    // Get archive data from SUP_OPS database (same DB, different stores)
    // Archives are stored as { id: 'current', data: ArchiveModel, lastModified: number }
    const archiveYoungEntry = await getFromStore<{
      id: string;
      data: { task: { ids: string[]; entities: Record<string, unknown> } };
    }>(db, 'archive_young', 'current');

    const archiveOldEntry = await getFromStore<{
      id: string;
      data: { task: { ids: string[]; entities: Record<string, unknown> } };
    }>(db, 'archive_old', 'current');

    const state = stateCacheEntry?.state || {};
    const defaultArchive = { task: { ids: [], entities: {} } };

    return {
      timestamp: Date.now(),
      lastUpdate: Date.now(),
      crossModelVersion: 4.5,
      data: {
        ...state,
        archiveYoung: archiveYoungEntry?.data || defaultArchive,
        archiveOld: archiveOldEntry?.data || defaultArchive,
      },
    };
  });

  // Write to temp file
  const tempDir = os.tmpdir();
  const backupPath = path.join(tempDir, `sp-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

  return backupPath;
};

/**
 * Helper to import backup file
 */
const importBackup = async (
  page: SimulatedE2EClient['page'],
  backupPath: string,
): Promise<void> => {
  // Navigate to settings/import page
  await page.goto('/#/config');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Navigate to Sync & Backup tab where Import/Export section is located
  const syncBackupTab = page.locator(
    'mat-tab-header .mat-mdc-tab:has-text("Sync & Backup"), mat-tab-header .mat-tab-label:has-text("Sync & Backup")',
  );
  await syncBackupTab.waitFor({ state: 'visible', timeout: 10000 });
  await syncBackupTab.click();
  await page.waitForTimeout(500);

  // Expand Import/Export section
  const importExportSection = page.locator('collapsible:has-text("Import/Export")');
  await importExportSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const collapsibleHeader = importExportSection.locator('.collapsible-header, .header');
  await collapsibleHeader.click();
  await page.waitForTimeout(500);

  // Set file on hidden input
  const fileInput = page.locator('file-imex input[type="file"]');
  await fileInput.setInputFiles(backupPath);

  // Wait for import to complete (app navigates to TODAY tag)
  const startTime = Date.now();
  const timeout = 30000;
  while (Date.now() - startTime < timeout) {
    const url = page.url();
    if (url.includes('tag') && url.includes('TODAY')) {
      break;
    }
    await page.waitForTimeout(500);
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
};

test.describe('@supersync Backup Recovery with Existing SYNC_IMPORT', () => {
  /**
   * CRITICAL TEST: Backup import should succeed even when SYNC_IMPORT exists
   *
   * This test verifies the fix for the bug where backup imports used
   * OpType.SyncImport (reason='initial') instead of OpType.BackupImport (reason='recovery').
   *
   * The bug caused 409 SYNC_IMPORT_EXISTS errors when users tried to recover
   * by importing a backup after a SYNC_IMPORT already existed on the server.
   *
   * Steps:
   * 1. Client A connects and syncs (creates SYNC_IMPORT on server)
   * 2. Client A creates a task, marks it done, archives it
   * 3. Client A syncs (uploads archive data)
   * 4. Client A exports backup (includes archive data)
   * 5. Client A imports the backup (should create BACKUP_IMPORT with reason='recovery')
   * 6. Client A syncs - BACKUP_IMPORT should be ACCEPTED (not 409)
   * 7. Client B connects and syncs
   * 8. Verify Client B has archived task in worklog
   *
   * Before the fix: Step 6 would fail with 409 SYNC_IMPORT_EXISTS
   * After the fix: Step 6 succeeds because BACKUP_IMPORT uses reason='recovery'
   */
  test('Backup import should succeed when SYNC_IMPORT already exists on server', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let backupPath: string | null = null;

    try {
      // Create a single sync provider (user)
      const user = await createTestUser(testRunId + '-backup-recovery');
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A connects and syncs ============
      console.log('[Backup Recovery] Phase 1: Client A connecting and syncing');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log('[Backup Recovery] Client A connected - SYNC_IMPORT created on server');

      // ============ PHASE 2: Client A creates and archives a task ============
      console.log('[Backup Recovery] Phase 2: Creating and archiving task');

      const archivedTaskName = `BackupRecoveryTest-${testRunId}`;
      await clientA.workView.addTask(archivedTaskName);
      await waitForTask(clientA.page, archivedTaskName);
      console.log(`[Backup Recovery] Created task: ${archivedTaskName}`);

      // Mark task as done
      await markTaskDone(clientA.page, archivedTaskName);
      console.log('[Backup Recovery] Marked task as done');

      // Archive the task via Daily Summary
      await archiveDoneTasks(clientA.page);
      console.log('[Backup Recovery] Archived task');

      // ============ PHASE 3: Client A syncs (uploads archive) ============
      console.log('[Backup Recovery] Phase 3: Syncing to upload archive');

      await clientA.sync.syncAndWait();
      console.log('[Backup Recovery] Client A synced with archived task');

      // Verify archived task appears in worklog
      const worklogCountBefore = await checkWorklogForArchivedTasks(clientA.page);
      console.log(
        `[Backup Recovery] Client A worklog entries before import: ${worklogCountBefore}`,
      );
      expect(worklogCountBefore).toBeGreaterThan(0);

      // ============ PHASE 4: Export backup ============
      console.log('[Backup Recovery] Phase 4: Exporting backup');

      backupPath = await exportBackup(clientA.page);
      console.log(`[Backup Recovery] Exported backup to: ${backupPath}`);

      // ============ PHASE 5: Import backup (CRITICAL - should use reason='recovery') ============
      console.log('[Backup Recovery] Phase 5: Importing backup');

      await importBackup(clientA.page, backupPath);
      console.log('[Backup Recovery] Backup imported');

      // ============ PHASE 6: Sync after import (CRITICAL - should NOT get 409) ============
      console.log(
        '[Backup Recovery] Phase 6: Syncing after import (should succeed, not 409)',
      );

      // Re-setup sync after import (import resets state)
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log(
        '[Backup Recovery] Client A synced after import - BACKUP_IMPORT accepted!',
      );

      // Verify archived task still in worklog
      const worklogCountAfter = await checkWorklogForArchivedTasks(clientA.page);
      console.log(
        `[Backup Recovery] Client A worklog entries after import: ${worklogCountAfter}`,
      );
      expect(worklogCountAfter).toBeGreaterThan(0);

      // ============ PHASE 7: Client B connects and syncs ============
      console.log('[Backup Recovery] Phase 7: Client B joining and syncing');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Backup Recovery] Client B synced');

      // Wait for state to settle
      await clientB.page.waitForTimeout(2000);

      // ============ PHASE 8: Verify Client B has archived task ============
      console.log('[Backup Recovery] Phase 8: Verifying Client B has archived task');

      const worklogCountB = await checkWorklogForArchivedTasks(clientB.page);
      console.log(`[Backup Recovery] Client B worklog entries: ${worklogCountB}`);

      // CRITICAL ASSERTION: Client B should have archived task from backup import
      expect(worklogCountB).toBeGreaterThan(
        0,
        'Client B should have archived task entries from BACKUP_IMPORT',
      );

      console.log('[Backup Recovery] ✓ Backup recovery test PASSED!');
      console.log(
        '[Backup Recovery] BACKUP_IMPORT was accepted by server (reason=recovery bypassed 409)',
      );
    } finally {
      // Cleanup
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
  });
});
