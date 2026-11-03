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

/**
 * 2b: a device that already has tasks joins a SuperSync account for the first
 * time. The account's history starts with the first device's snapshot, so the
 * device gets the sync-import dialog, in its first-sync layout: the device's
 * task count, "Use my account's tasks" preselected for a few tasks, a warning
 * on "Replace my account". Keeping the account's tasks saves the device's own
 * tasks as a backup first, and they can be restored from Settings → Sync & Backup.
 * A device with many tasks gets no warning when the account's snapshot holds
 * at least half as many; with twice as many or more, nothing is preselected and
 * "Use my account's tasks" warns.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-first-sync-choice.spec.ts
 */
test.describe('@supersync First-sync choice when joining with local tasks', () => {
  test("uses the account's tasks and keeps the device's tasks restorable", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ A sets up the account ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const taskA = `A1-${testRunId}`;
      await clientA.workView.addTask(taskA);
      await clientA.sync.syncAndWait();

      // ============ B already has tasks and joins ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      const tasksB = [`B1-${testRunId}`, `B2-${testRunId}`];
      for (const task of tasksB) {
        await clientB.workView.addTask(task);
      }
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.sync.syncImportConflictDialog;
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(dialog.locator('.e2e-first-sync-count')).toHaveText(
        'Tasks on this device: 2',
      );
      const warning = dialog.locator('.e2e-first-sync-warning');
      const useAccount = clientB.sync.firstSyncUseAccountRadio.locator('input');
      // Few tasks: the safe choice is preselected and needs no warning.
      await expect(useAccount).toBeChecked();
      await expect(warning).toBeHidden();
      await expect(clientB.sync.firstSyncSubmitBtn).toHaveText(/Continue/);

      // Replacing the account always warns, and the button says what it does.
      await clientB.sync.firstSyncReplaceAccountRadio.locator('input').check();
      await expect(warning).toContainText('removes all tasks from your account');
      await expect(clientB.sync.firstSyncSubmitBtn).toHaveText(
        /Remove the account's tasks/,
      );

      await clientB.sync.chooseSyncImportUseRemote();
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/work-view');
      await waitForTask(clientB.page, taskA);
      for (const task of tasksB) {
        await expect(clientB.page.locator(`task:has-text("${task}")`)).toHaveCount(0);
      }

      // ============ B's own tasks wait in the backups list ============
      await new ImportPage(clientB.page).navigateToImportPage();
      await clientB.page
        .locator('config-page')
        .getByRole('button', { name: 'Browse backups' })
        .click();
      const listDialog = clientB.page.locator('dialog-backups-list');
      const backupRow = listDialog.locator('.backup', {
        hasText: 'before "Use server data"',
      });
      await expect(backupRow).toBeVisible({ timeout: 10000 });
      await backupRow.click();
      await expect(backupRow).toContainText('2 tasks', { timeout: 10000 });

      await listDialog.getByRole('button', { name: 'Restore' }).click();
      await clientB.page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
      await expect(listDialog).toBeHidden({ timeout: 30000 });

      await clientB.page.goto('/#/work-view');
      for (const task of tasksB) {
        await waitForTask(clientB.page, task);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test("doesn't warn about the account's tasks when the account has nearly as many", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // A's tasks exist before setup, so the account's snapshot holds all 10.
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      for (let i = 1; i <= 10; i++) {
        await clientA.workView.addTask(`A${i}-${testRunId}`);
      }
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // 12 tasks would warn without the account's count, but are not twice 10.
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      for (let i = 1; i <= 12; i++) {
        await clientB.workView.addTask(`B${i}-${testRunId}`);
      }
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.sync.syncImportConflictDialog;
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(dialog.locator('.e2e-first-sync-count')).toHaveText(
        'Tasks on this device: 12',
      );
      await expect(clientB.sync.firstSyncUseAccountRadio.locator('input')).toBeChecked();
      await expect(dialog.locator('.e2e-first-sync-warning')).toBeHidden();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test("warns before using the account's tasks when the device has far more", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // A's task exists before setup, so the account's snapshot holds it.
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      const taskA = `A1-${testRunId}`;
      await clientA.workView.addTask(taskA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // 10 tasks is the smallest count that warns, and far more than 1.
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      for (let i = 1; i <= 10; i++) {
        await clientB.workView.addTask(`B${i}-${testRunId}`);
      }
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.sync.syncImportConflictDialog;
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(dialog.locator('.e2e-first-sync-count')).toHaveText(
        'Tasks on this device: 10',
      );
      const warning = dialog.locator('.e2e-first-sync-warning');
      const useAccount = clientB.sync.firstSyncUseAccountRadio.locator('input');
      // Much is at stake either way, so nothing is chosen for the user.
      await expect(useAccount).not.toBeChecked();
      await expect(
        clientB.sync.firstSyncReplaceAccountRadio.locator('input'),
      ).not.toBeChecked();
      await expect(clientB.sync.firstSyncSubmitBtn).toBeDisabled();
      await expect(warning).toBeHidden();

      await useAccount.check();
      await expect(warning).toContainText('This removes 10 tasks from this device');
      await expect(clientB.sync.firstSyncSubmitBtn).toHaveText(/Remove 10 tasks/);
      await expect(clientB.sync.firstSyncSubmitBtn).toBeEnabled();

      await clientB.sync.chooseSyncImportUseRemote();
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/work-view');
      await waitForTask(clientB.page, taskA);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
