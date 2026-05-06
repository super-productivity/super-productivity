import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7344
 *
 * When an existing task with a PAST dueDay is converted into a YEARLY
 * recurring task (dialog's default startDate = task.dueDay), the task's
 * dueDay was silently advanced to the next future occurrence (e.g., a task
 * planned for 2026-04-01 ended up scheduled for 2027-04-01), removing it
 * from the Today view without user consent.
 *
 * Expected: the task's planned date is preserved. The task should remain
 * visible in Today view (as overdue) after the conversion.
 *
 * Strategy: Use `page.clock.setFixedTime()` to create a task "today" on an
 * early date, advance the clock past that date so the task's dueDay becomes
 * past, then convert to YEARLY recurring via the repeat dialog and verify
 * the task still appears in Today.
 */
test.describe('Recurring Task - preserve past dueDay (#7344)', () => {
  test('should keep task in Today when converting a past-dated task to YEARLY recurring', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-Preserve7344`;

    // 1. Boot on April 1, 2026 and create a task — it gets dueDay = 2026-04-01.
    await page.clock.setFixedTime(new Date('2026-04-01T10:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 2. Advance the clock ~3 weeks so the task's dueDay is now in the past,
    //    reload so the app picks up the new "today".
    await page.clock.setFixedTime(new Date('2026-04-23T10:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // Baseline: an overdue (past-dueDay) task is still rendered in Today view
    // on reload until a day-change event fires. This mirrors what the user
    // observed in #7344 before they converted the task to recurring.
    await expect(taskPage.getTaskByText(taskTitle).first()).toBeVisible({
      timeout: 10000,
    });

    // 3. Open the repeat dialog via the task detail panel.
    const reopenedTask = taskPage.getTaskByText(taskTitle).first();
    await taskPage.openTaskDetail(reopenedTask);
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Switch to CUSTOM so repeatCycle becomes editable without overriding
    //    startDate (picking YEARLY_CURRENT_DATE would reset startDate to today).
    const quickSettingSelect = repeatDialog.locator('mat-select').first();
    await quickSettingSelect.click();
    const customOption = page.locator('mat-option').filter({ hasText: /Custom/i });
    await customOption.click();

    // 5. Set repeat cycle to YEARLY (default is WEEKLY under CUSTOM).
    const repeatCycleSelect = repeatDialog.locator('.repeat-cycle mat-select').first();
    await expect(repeatCycleSelect).toBeVisible({ timeout: 5000 });
    await repeatCycleSelect.click();
    const yearlyOption = page.locator('mat-option').filter({ hasText: /Year/i });
    await yearlyOption.click();

    // 6. Save the repeat config.
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
    await page.keyboard.press('Escape');

    // 7. ASSERTION: after reload, the task remains visible in Today view.
    //    Before the fix: task.dueDay was auto-shifted to 2027-04-01 and the
    //    task disappeared from Today. After the fix: task.dueDay is preserved
    //    at 2026-04-01 (past, still overdue) and the task stays visible.
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText(taskTitle).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
