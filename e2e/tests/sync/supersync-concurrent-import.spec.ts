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
 * A uploads first: its BACKUP_IMPORT replaces the server state. B then
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

      // ============ Concurrent imports, no sync in between ============
      for (const [client, backup, marker] of [
        [clientA, backupA, markerA],
        [clientB, backupB, markerB],
      ] as const) {
        const importPage = new ImportPage(client.page);
        await importPage.navigateToImportPage();
        await importPage.importBackupFile(backup);
        // An import may reload the app, which clears setupSuperSync's
        // background-sync blocks; nothing may upload before the explicit syncs.
        await client.page.evaluate(blockBackgroundSync);
        await expect.poll(() => getTaskTitleFromState(client, marker)).toBe(marker);
        expect(await getTaskTitleFromState(client, baseline)).toBeNull();
      }

      // ============ A uploads its import first ============
      await clientA.sync.syncAndWait();

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
