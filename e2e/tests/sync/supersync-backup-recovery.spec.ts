import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDoneByKey,
  archiveDoneTasks,
  getLocalOpLogSummary,
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
  hasEverAppeared,
  watchNeverAppears,
} from '../../utils/audit-archive-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * SuperSync Backup Recovery E2E Tests
 *
 * A backup import creates a BACKUP_IMPORT op, uploaded with reason='recovery'
 * as a clean slate. The server rejects a reason='initial' snapshot with 409
 * SYNC_IMPORT_EXISTS when the account already holds a full-state op, and the
 * client then silently drops its local import (operation-log-upload.service.ts,
 * SYNC_IMPORT_EXISTS branch) and adopts the server state. So the precondition
 * that matters is a full-state op already on the server, and the failure is
 * silent: only the uploaded op and the resulting data reveal it.
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
   * 4. Client A imports the backup and syncs: the BACKUP_IMPORT must be
   *    accepted (synced locally, held by the server, nothing older kept).
   * 5. Fresh Client B joins: it must get the backup's state (archived task in
   *    archive_young) and NOT the server-only task.
   *
   * If the BACKUP_IMPORT were uploaded as reason='initial' without a clean
   * slate, step 4 would hit 409 SYNC_IMPORT_EXISTS, the client would drop the
   * import, and B would see the server-only task.
   */
  test('Backup import should succeed when SYNC_IMPORT already exists on server', async ({
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

      // Evidence only: log whether the helper had to answer a conflict dialog.
      await watchNeverAppears(clientA.page, 'dialog-sync-import-conflict', 'conflict');
      // Restoring the backup is the user's intent, so keep local if asked.
      await clientA.sync.setupSuperSync({ ...syncConfig2, syncImportChoice: 'local' });
      await clientA.sync.syncAndWait({ useLocal: true });
      console.log(
        `[Backup Recovery] Conflict dialog during post-import sync: ${await hasEverAppeared(
          clientA.page,
          'conflict',
        )}`,
      );

      // The BACKUP_IMPORT must have been accepted, not dropped on a 409.
      const importer = clientA;
      await expect
        .poll(
          async () =>
            (await getLocalOpLogSummary(importer.page))
              .filter((e) => e.opType === 'BACKUP_IMPORT')
              .map((e) => e.isSynced),
          { message: 'Client A: local BACKUP_IMPORT must be synced', timeout: 15000 },
        )
        .toEqual([true]);
      console.log(
        `[Backup Recovery] Server ops: ${(await getServerOpTypes(user2.userId)).join(', ')}`,
      );
      expect(await expectServerHistoryStartsAtImport(user2.userId, 'Account 2')).toBe(
        'BACKUP_IMPORT',
      );

      // ============ PHASE 5: Fresh Client B gets the backup's state ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig2);
      await clientB.sync.syncAndWait();

      // Positive anchor: the backup's archived task is in B's archive.
      await expectArchivedNotLive(clientB, [archivedTaskId], 'Client B');
      await waitForTask(clientB.page, seedTask);
      expect(
        await getLiveIds(clientB, [serverOnlyTaskId]),
        'Client B: the server-only task must be gone after the BACKUP_IMPORT',
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
