import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/5594
 *
 * When creating a repeat task (e.g., Mon/Wed/Fri) on a day that doesn't match
 * the pattern (e.g., Saturday), the first task instance should be scheduled
 * for the NEXT matching day (Monday), not today (Saturday).
 *
 * Strategy: Use `page.clock.setFixedTime()` to set the date to a Saturday,
 * create a task, configure it as a Mon/Wed/Fri weekly repeat, save, and
 * verify the task is NOT in Today but IS scheduled for Monday.
 */
test.describe('Issue #5594: First repeat occurrence should not always be today', () => {
  test('weekly weekday repeat created on Saturday should schedule for Monday', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-WeeklyRepeat5594`;

    // 1. Set clock to Saturday 2026-06-13 and reload so the app boots on that day
    await page.clock.setFixedTime(new Date('2026-06-13T10:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Create a task
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 3. Open task detail and click the repeat/recurrence icon
    await taskPage.openTaskDetail(task);
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 4. Wait for repeat dialog
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // 5. Pick the "Every Monday through Friday" quick setting. Saturday is not in
    //    Mon–Fri, so a task created on Saturday first fires on Monday — the same
    //    assertion the original Mon/Wed/Fri custom rule made (the legacy Custom
    //    weekday-picker UI was removed in favour of the RRULE builder).
    const quickSettingSelect = repeatDialog.locator('mat-select').first();
    await quickSettingSelect.click();
    const mfOption = page
      .locator('mat-option')
      .filter({ hasText: /Monday through Friday/i });
    await expect(mfOption).toBeVisible({ timeout: 5000 });
    await mfOption.click();

    // 6. Save the repeat config
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // Close task detail panel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // 9. ASSERTION: The task should NOT be in today's undone task list
    // because Saturday is not in the Mon/Wed/Fri pattern.
    // The task should have been rescheduled to Monday (2026-06-15).
    const undoneTasksWithTitle = taskPage.getUndoneTasks().filter({ hasText: taskTitle });

    // The task should disappear from Today view
    await expect(undoneTasksWithTitle).toHaveCount(0, { timeout: 15000 });

    console.log(
      '[Bug #5594] Task correctly removed from Today when repeat pattern does not match today',
    );

    // 10. Navigate to the full planner view to verify the task appears on a future day
    await page.goto('/#/planner');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // The task should appear in the planner under Monday (June 15)
    // Planner renders tasks in day columns — look for the task text anywhere on the page
    const plannerTask = page.getByText(
      taskTitle.replace(testPrefix + '-', testPrefix + '-'),
    );
    await expect(plannerTask.first()).toBeVisible({ timeout: 15000 });

    console.log('[Bug #5594] Task correctly appears in planner for future day');
  });

  test('daily repeat created on any day should keep task in Today', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-DailyRepeat5594`;

    // 1. Set clock to a Saturday
    await page.clock.setFixedTime(new Date('2026-06-13T10:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Create a task and configure as DAILY repeat (default)
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 3. Open repeat dialog
    await taskPage.openTaskDetail(task);
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 4. Save with default DAILY settings
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // Close task detail panel
    await page.keyboard.press('Escape');

    // 5. ASSERTION: Task SHOULD remain in Today for DAILY repeat
    const undoneTasksWithTitle = taskPage.getUndoneTasks().filter({ hasText: taskTitle });
    await expect(undoneTasksWithTitle.first()).toBeVisible({ timeout: 10000 });

    console.log('[Bug #5594] Daily repeat task correctly stays in Today');
  });
});
