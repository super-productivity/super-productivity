import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDoneByKey,
  archiveDoneTasks,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';
import {
  expectArchivedNotLive,
  expectServerHistoryStartsAtImport,
  getLiveIds,
  getServerOpTypes,
  getServerOps,
  getTaskIdByTitle,
} from '../../utils/audit-archive-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * SuperSync Backup Recovery E2E Tests
 *
 * Restoring a backup on an account whose server already holds a full-state op
 * (here: the SYNC_IMPORT a server migration uploads).
 *
 * What actually happens (measured 2026-11, CI run 41735107614): the import
 * resets lastServerSeq and mints a new clientId (backup.service.ts), so the
 * next sync downloads the server's SYNC_IMPORT while the BACKUP_IMPORT is still
 * pending. That raises the sync-import conflict dialog; "Use My Data"
 * force-uploads the restored state as a clean-slate SYNC_IMPORT. The
 * BACKUP_IMPORT's own reason='recovery' upload is not reached on this path, so
 * the test asserts the dialog and the outcome instead.
 *
 * What it guards: the restore must end up as the server's clean-slate history
 * (no pre-restore op left) and be what a fresh client receives. It does NOT
 * guard the original reason='initial' → 409 SYNC_IMPORT_EXISTS bug: the "Use
 * My Data" force upload is always a clean slate, and the server only answers
 * 409 for reason='initial' WITHOUT a clean slate
 * (sync.routes.snapshot-handler.ts), so mapping BackupImport to 'initial' in
 * operation-log-upload.service.ts would not fail this test. That mapping is
 * covered by the upload service's unit tests.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-backup-recovery.spec.ts
 */

/** Export a backup through the UI (Settings > Sync & Backup > Export Data). */
const exportBackup = async (page: SimulatedE2EClient['page']): Promise<string> => {
  const importPage = new ImportPage(page);
  await importPage.navigateToImportPage();
  const backupPath = path.join(os.tmpdir(), `sp-backup-recovery-${Date.now()}.json`);
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  // Exact name: a sibling "Export Data (anonymized)" button shares the prefix.
  await page.getByRole('button', { name: 'Export Data', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(backupPath);
  await page.goto('/#/tag/TODAY/tasks');
  await page.waitForLoadState('networkidle');
  return backupPath;
};

test.describe('@supersync Backup Recovery with Existing SYNC_IMPORT', () => {
  /**
   * Steps:
   * 1. Client A syncs a seed task to account 1, then switches to the empty
   *    account 2: the server migration uploads a SYNC_IMPORT there. This is
   *    the precondition (asserted on the server).
   * 2. Client A creates a task, archives it, syncs, and exports a backup.
   * 3. Client A creates a "server-only" task and syncs it, so the server state
   *    now differs from the backup.
   * 4. Client A imports the backup and syncs: the sync-import conflict dialog
   *    appears (asserted), the user keeps the restored data, and the server
   *    history must then start at a clean-slate import.
   * 5. Fresh Client B joins: it must get the backup's state (archived task in
   *    archive_young) and NOT the server-only task.
   */
  test('Backup restore wins over an existing server SYNC_IMPORT via Use My Data', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let backupPath: string | null = null;

    try {
      const user1 = await createTestUser(`${testRunId}-recovery-1`);
      const user2 = await createTestUser(`${testRunId}-recovery-2`);
      const syncConfig2 = getSuperSyncConfig(user2);

      // ============ PHASE 1: Put a SYNC_IMPORT on account 2 ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(getSuperSyncConfig(user1));
      const seedTask = `RecoverySeed-${testRunId}`;
      await clientA.workView.addTask(seedTask);
      await clientA.sync.syncAndWait();

      await clientA.sync.setupSuperSync(syncConfig2);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, seedTask);
      const opsAfterMigration = await getServerOps(user2.userId);
      expect(
        opsAfterMigration.map((op) => op.opType),
        'precondition: account 2 must hold a SYNC_IMPORT before the backup import',
      ).toContain('SYNC_IMPORT');
      console.log('[Backup Recovery] Account 2 holds a SYNC_IMPORT');

      // ============ PHASE 2: Archived task, synced, then exported ============
      const archivedTaskName = `BackupRecoveryArchived-${testRunId}`;
      await clientA.workView.addTask(archivedTaskName);
      await waitForTask(clientA.page, archivedTaskName);
      const archivedTaskId = await getTaskIdByTitle(clientA, archivedTaskName);
      await markTaskDoneByKey(clientA, archivedTaskName);
      await archiveDoneTasks(clientA);
      await clientA.sync.syncAndWait();
      await expectArchivedNotLive(clientA, [archivedTaskId], 'Client A before export');

      backupPath = await exportBackup(clientA.page);
      console.log('[Backup Recovery] Exported backup');

      // ============ PHASE 3: Make the server differ from the backup ============
      const serverOnlyTask = `BackupRecoveryServerOnly-${testRunId}`;
      await clientA.workView.addTask(serverOnlyTask);
      await waitForTask(clientA.page, serverOnlyTask);
      const serverOnlyTaskId = await getTaskIdByTitle(clientA, serverOnlyTask);
      await clientA.sync.syncAndWait();
      const seqBeforeRestore = Math.max(
        ...(await getServerOps(user2.userId)).map((op) => op.serverSeq),
      );
      console.log('[Backup Recovery] Server-only task synced');

      // ============ PHASE 4: Import the backup and sync ============
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(backupPath);
      await clientA.page.goto('/#/tag/TODAY/tasks', { waitUntil: 'domcontentloaded' });
      await clientA.page.waitForLoadState('networkidle');
      expect(
        await getLiveIds(clientA, [serverOnlyTaskId]),
        'Client A after import: the backup predates the server-only task',
      ).toEqual([]);

      // The restore conflicts with the server's SYNC_IMPORT: assert the dialog
      // explicitly instead of letting the helper answer it.
      await clientA.sync.setupSuperSync({ ...syncConfig2, waitForInitialSync: false });
      const conflictDialog = clientA.page.locator('dialog-sync-import-conflict');
      await expect(conflictDialog).toBeVisible({ timeout: 30000 });
      await clientA.sync.chooseSyncImportUseLocal();
      await expect(conflictDialog).not.toBeVisible();
      await clientA.sync.waitForSyncToComplete({
        timeout: 30000,
        skipSpinnerCheck: true,
      });
      await clientA.sync.syncAndWait();
      expect(await clientA.sync.hasSyncError()).toBe(false);

      // The restore must have replaced the server history, not been dropped on
      // a 409: a clean-slate import first, nothing older (the migration's
      // SYNC_IMPORT and the server-only task's op must be gone).
      console.log(
        `[Backup Recovery] Server ops: ${(await getServerOpTypes(user2.userId)).join(', ')}`,
      );
      await expectServerHistoryStartsAtImport(user2.userId, 'Account 2');
      const preRestoreOps = (await getServerOps(user2.userId))
        .filter((op) => op.serverSeq <= seqBeforeRestore)
        .map((op) => `${op.opType}@${op.serverSeq}`);
      expect(preRestoreOps, 'Account 2: pre-restore ops must be wiped').toEqual([]);

      // ============ PHASE 5: Fresh Client B gets the backup's state ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig2);
      await clientB.sync.syncAndWait();

      // Positive anchor: the backup's archived task is in B's archive.
      await expectArchivedNotLive(clientB, [archivedTaskId], 'Client B');
      await waitForTask(clientB.page, seedTask);
      expect(
        await getLiveIds(clientB, [serverOnlyTaskId]),
        'Client B: the server-only task must be gone after the restore',
      ).toEqual([]);
      console.log('[Backup Recovery] ✓ Client B has the backup state only');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
  });
});
