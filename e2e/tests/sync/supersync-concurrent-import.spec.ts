import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  getTaskTitleFromState,
  isFullStateOpType,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';
import { blockBackgroundSync } from '../../utils/time-preserving-resolution-helpers';
import { getServerOps, writeMarkedBackup } from '../../utils/audit-concurrency-helpers';

/**
 * SuperSync Concurrent BACKUP_IMPORT E2E Test
 *
 * Two synced clients each import a different backup with no sync in between,
 * so both hold an unsynced full-state op that knows nothing of the other.
 * A uploads first; its import is concurrent with an op B uploaded earlier,
 * so A is asked too and keeps its own data: its BACKUP_IMPORT replaces the
 * server state. B then
 * downloads A's import while its own import is still pending, so B must ask
 * (sync-import conflict dialog) instead of silently picking one. B accepts the
 * server's data. Afterwards every client holds exactly A's backup and the
 * server exactly one full-state op.
 *
 * Posting a client's own later ops after an import is covered by
 * supersync-import-same-client-ops.spec.ts.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-concurrent-import.spec.ts
 */

test.describe('@supersync @concurrent-import Concurrent BACKUP_IMPORT handling', () => {
  test('Two concurrent imports converge on the import the user keeps', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    const clients: SimulatedE2EClient[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const markerA = `ImportMarkerA-${testRunId}`;
      const markerB = `ImportMarkerB-${testRunId}`;
      const backupA = writeMarkedBackup(
        'test-backup.json',
        markerA,
        test.info().outputPath('backup-a.json'),
      );
      const backupB = writeMarkedBackup(
        'test-backup.json',
        markerB,
        test.info().outputPath('backup-b.json'),
      );

      // ============ Both clients synced on a shared baseline ============
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      const baseline = `Baseline-${testRunId}`;
      await clientA.workView.addTask(baseline);
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, baseline);
      // B's op reaches the server before either import, so A's own first sync
      // after its import meets remote ops concurrent with it and must ask.
      const fromB = `FromB-${testRunId}`;
      await clientB.workView.addTask(fromB);
      await clientB.sync.syncAndWait();

      const fullStateOpCount = async (): Promise<number> =>
        (await getServerOps(user.userId)).filter((op) => isFullStateOpType(op.opType))
          .length;
      const fullStateOpsBeforeImports = await fullStateOpCount();

      // ============ Concurrent imports, no sync in between ============
      for (const [client, backup, marker] of [
        [clientA, backupA, markerA],
        [clientB, backupB, markerB],
      ] as const) {
        const importPage = new ImportPage(client.page);
        await importPage.navigateToImportPage();
        await importPage.importBackupFile(backup);
        // Defensive: re-assert setupSuperSync's background-sync blocks so
        // nothing uploads before the explicit syncs (checked on the server below).
        await client.page.evaluate(blockBackgroundSync);
        await expect.poll(() => getTaskTitleFromState(client, marker)).toBe(marker);
        expect(await getTaskTitleFromState(client, baseline)).toBeNull();
        expect(await getTaskTitleFromState(client, fromB)).toBeNull();
      }

      // Neither import reached the server yet, so they really are concurrent.
      expect(await fullStateOpCount()).toBe(fullStateOpsBeforeImports);

      // ============ A uploads its import first ============
      // syncAndWait() would answer this dialog with USE_REMOTE and silently
      // drop A's import (observed in E2E run 41735806038); answer it explicitly.
      await clientA.sync.clickSyncBtn();
      await expect(clientA.sync.syncImportConflictDialog).toBeVisible({ timeout: 30000 });
      await clientA.sync.chooseSyncImportUseLocal();
      await clientA.sync.syncAndWait();
      await expect.poll(() => getTaskTitleFromState(clientA, markerA)).toBe(markerA);

      // ============ B downloads A's import while its own is pending ============
      await clientB.sync.clickSyncBtn();
      await expect(clientB.sync.syncImportConflictDialog).toBeVisible({ timeout: 30000 });
      await clientB.sync.chooseSyncImportUseRemote();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      // ============ Verify: exactly A's backup everywhere ============
      for (const client of clients) {
        await expect.poll(() => getTaskTitleFromState(client, markerA)).toBe(markerA);
        expect(await getTaskTitleFromState(client, markerB)).toBeNull();
        expect(await getTaskTitleFromState(client, baseline)).toBeNull();
        expect(await getTaskTitleFromState(client, fromB)).toBeNull();
      }

      const fullStateOps = (await getServerOps(user.userId)).filter((op) =>
        isFullStateOpType(op.opType),
      );
      console.log(
        '[Concurrent Import] server full-state ops:',
        fullStateOps.map((op) => `${op.opType}@${op.serverSeq}`).join(', '),
      );
      expect(fullStateOps).toHaveLength(1);

      // A fresh client receives the same single import.
      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await expect.poll(() => getTaskTitleFromState(clientC, markerA)).toBe(markerA);
      expect(await getTaskTitleFromState(clientC, markerB)).toBeNull();
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
