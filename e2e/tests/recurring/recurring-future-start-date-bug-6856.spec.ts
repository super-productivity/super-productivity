import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6856
 *
 * When a recurring task is created with a future start date, an active task
 * instance is immediately generated and placed in the Inbox on the same day
 * of creation, ignoring the configured start date entirely.
 *
 * Expected: No active task instance should appear until the configured start
 * date arrives. The task should be scheduled for the start date.
 */
test.describe('Recurring Task - Future Start Date (#6856)', () => {
  test('should not show task in today view when made recurring with future start date', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // 1. Create a task in the today view
    const taskTitle = `${testPrefix}-FutureRecur`;
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 2. Open task detail and click on recur to open the repeat dialog
    await task.hover();
    await page.waitForTimeout(200);
    const detailBtn = page.getByRole('button', {
      name: 'Show/Hide additional info',
    });
    await detailBtn.click();
    await page.waitForTimeout(300);

    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await recurItem.click();

    // 3. Wait for the repeat dialog and set a future start date
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Set startDate via Angular's dialog component model signal
    // (mat-datepicker's signal-based inputs don't work from page.evaluate)
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);
    futureDate.setDate(15);
    const year = futureDate.getFullYear();
    const month = String(futureDate.getMonth() + 1).padStart(2, '0');
    const day = String(futureDate.getDate()).padStart(2, '0');
    const futureDateStr = `${year}-${month}-${day}`;

    await page.evaluate((dateStr) => {
      const ng = (window as any).ng;
      const dialogEl = document.querySelector(
        'mat-dialog-container dialog-edit-task-repeat-cfg',
      );
      if (!ng || !dialogEl) throw new Error('Dialog component not found');
      const component = ng.getComponent(dialogEl);
      if (!component) throw new Error('Dialog component instance not found');
      component.repeatCfg.update((cfg: any) => ({ ...cfg, startDate: dateStr }));
    }, futureDateStr);
    await page.waitForTimeout(300);

    // Save the repeat config — wait for the button to be enabled first
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // 4. Wait for effects and persistence to process
    await page.waitForTimeout(5000);

    // 5. Reload and navigate to today view to verify persisted state
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();

    // 6. Assert: task should NOT be visible in today's task list
    // Bug #6856: The task appears immediately instead of being scheduled
    // for the configured future start date.
    await expect(taskPage.getTaskByText(taskTitle)).not.toBeVisible({ timeout: 5000 });
  });
});
