import { test, expect } from '../../fixtures/supersync.fixture';
import { TaskPage } from '../../pages/task.page';
import {
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
} from '../../utils/recurring-task-helpers';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getTaskElement,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Exercises the actual TASK_REPEAT_CFG entity through its production dialog.
 * Scheduled-task tests only cover dueDay fields on TASK and cannot detect a
 * missing repeat-config operation or a broken task.repeatCfgId relationship.
 */
test.describe('@supersync Repeat Configuration', () => {
  test('repeat config creation and update sync between clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(150000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      const taskTitle = `RepeatCfg-${testRunId}`;
      const taskPageA = new TaskPage(clientA.page, testRunId);
      const taskPageB = new TaskPage(clientB.page, testRunId);

      await clientA.workView.addTask(taskTitle);
      await waitForTask(clientA.page, taskTitle);
      await taskPageA.openTaskDetail(getTaskElement(clientA, taskTitle));
      await openRecurDialog(clientA.page);
      await setRecurQuickSetting(clientA.page, /^Every day$/i);
      await saveRecurDialog(clientA.page);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskTitle);

      // B received both the repeat config and the task's repeatCfgId reference.
      await taskPageB.openTaskDetail(getTaskElement(clientB, taskTitle));
      const repeatItemB = clientB.page
        .locator('task-detail-item')
        .filter({ has: clientB.page.locator('mat-icon', { hasText: /^repeat$/ }) });
      await expect(repeatItemB).toContainText('Every day');

      // Update the real config on B and verify A receives the new schedule.
      await openRecurDialog(clientB.page);
      await setRecurQuickSetting(clientB.page, /Every Monday through Friday/i);
      await saveRecurDialog(clientB.page);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      const repeatItemA = clientA.page
        .locator('task-detail-item')
        .filter({ has: clientA.page.locator('mat-icon', { hasText: /^repeat$/ }) });
      await expect(repeatItemA).toContainText('Recur Mon-Fri');
      const dialogA = await openRecurDialog(clientA.page);
      await expect(dialogA.locator('mat-select').first()).toContainText(
        'Every Monday through Friday',
      );
      await dialogA.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialogA).toBeHidden();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
