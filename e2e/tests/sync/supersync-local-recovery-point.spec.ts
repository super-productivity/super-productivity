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
import { readRecoveryRing } from '../../utils/recovery-ring-helpers';

/**
 * Local recovery points (docs/sync-and-op-log/local-recovery-points.md)
 *
 * A late joiner with almost no data chooses "Use My Data". Its SYNC_IMPORT
 * replaces the server state and, on the next sync, wipes the other device.
 * That device must:
 *  - capture a recovery point before applying the remote full-state op
 *  - warn with a banner because the incoming data is much smaller
 *  - list the recovery point in Settings → Sync & Backup → Browse backups
 *  - restore it, which then propagates back to the late joiner
 * A pristine device joining afterwards must NOT capture anything: a fresh
 * install (default counters, system tags) never takes a ring slot.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-local-recovery-point.spec.ts
 */
test.describe('@supersync @recovery-point Local recovery point after remote wipe', () => {
  test('device wiped by a remote SYNC_IMPORT can restore from the recovery ring', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: A holds the real data ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const tasksA = [`A1-${testRunId}`, `A2-${testRunId}`, `A3-${testRunId}`];
      for (const task of tasksA) {
        await clientA.workView.addTask(task);
      }
      await clientA.sync.syncAndWait();
      console.log('[RecoveryPoint] Client A synced 3 tasks');

      // ============ PHASE 2: B joins with 1 task and keeps its own data ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      const taskB = `B1-${testRunId}`;
      await clientB.workView.addTask(taskB);
      await clientB.sync.setupSuperSync({ ...syncConfig, syncImportChoice: 'local' });
      await clientB.sync.syncAndWait({ useLocal: true });
      console.log('[RecoveryPoint] Client B replaced server data with 1 task');

      // ============ PHASE 3: A syncs and gets wiped, but keeps a recovery point ============
      await clientA.sync.syncAndWait();
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, taskB);
      for (const task of tasksA) {
        await expect(clientA.page.locator(`task:has-text("${task}")`)).not.toBeVisible({
          timeout: 5000,
        });
      }
      console.log('[RecoveryPoint] Client A adopted B data (3 → 1 tasks)');

      const banner = clientA.page.locator('banner', { hasText: 'recovery point' });
      await expect(banner).toBeVisible({ timeout: 10000 });
      await expect(banner.getByRole('button', { name: 'Browse backups' })).toBeVisible();
      console.log('[RecoveryPoint] ✓ Shrink banner shown on Client A');
      expect(
        (await readRecoveryRing(clientA.page)).map((e) => [e.reason, e.taskCount]),
      ).toEqual([['REMOTE_IMPORT', 3]]);

      // ============ PHASE 4: Browse backups from Settings → Sync & Backup ============
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      await clientA.page
        .locator('config-page')
        .getByRole('button', { name: 'Browse backups' })
        .click();

      const listDialog = clientA.page.locator('dialog-backups-list');
      await expect(listDialog).toBeVisible({ timeout: 10000 });
      const recoveryRow = listDialog.locator('.backup', {
        hasText: 'before sync replaced local data',
      });
      await expect(recoveryRow).toBeVisible({ timeout: 10000 });
      await recoveryRow.click();
      await expect(recoveryRow).toContainText('3 tasks', { timeout: 10000 });
      console.log('[RecoveryPoint] ✓ Recovery point listed with 3 tasks');

      // ============ PHASE 5: Restore it ============
      await listDialog.getByRole('button', { name: 'Restore' }).click();
      const confirmBtn = clientA.page.locator('dialog-confirm button[e2e="confirmBtn"]');
      await expect(confirmBtn).toBeVisible({ timeout: 5000 });
      await confirmBtn.click();
      await expect(listDialog).not.toBeVisible({ timeout: 30000 });

      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      for (const task of tasksA) {
        await waitForTask(clientA.page, task);
      }
      await expect(clientA.page.locator(`task:has-text("${taskB}")`)).not.toBeVisible({
        timeout: 5000,
      });
      console.log('[RecoveryPoint] ✓ Client A restored its 3 tasks');
      // The restore itself captured the 1-task state it replaced.
      expect((await readRecoveryRing(clientA.page)).map((e) => e.reason)).toEqual([
        'LOCAL_IMPORT',
        'REMOTE_IMPORT',
      ]);

      // ============ PHASE 6: The restore propagates back to B ============
      // The restore is a local BACKUP_IMPORT; the re-download raises the
      // sync-import conflict dialog on A, which must keep its own data.
      await clientA.sync.syncAndWait({ useLocal: true });
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      for (const task of tasksA) {
        await waitForTask(clientB.page, task);
      }
      console.log('[RecoveryPoint] ✓ Client B received the restored data');

      // ============ PHASE 7: A pristine device joining takes no ring slot ============
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await clientC.page.goto('/#/work-view');
      await clientC.page.waitForLoadState('networkidle');
      for (const task of tasksA) {
        await waitForTask(clientC.page, task);
      }
      expect(await readRecoveryRing(clientC.page)).toEqual([]);
      console.log('[RecoveryPoint] ✓ Pristine Client C captured nothing');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
