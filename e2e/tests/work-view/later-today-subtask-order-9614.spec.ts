import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issue #9614: Sorting sub-tasks of a repeating task does not apply on Today.
 *
 * A repeating task with a time (e.g. "Every day, 22:00") creates a daily
 * instance scheduled for later today, which is rendered in the "Later Today"
 * panel of the Today view. Reordering its subtasks updates parent.subTaskIds
 * (visible in the task detail panel), but the "Later Today" panel kept
 * rendering the subtasks in store insertion order because
 * selectLaterTodayStructure derived the subtask order from snapshot iteration
 * order instead of parent.subTaskIds.
 *
 * This test schedules a parent for later today (same selector path as a
 * repeating instance), reorders its subtasks via the keyboard shortcut
 * (Ctrl+Shift+ArrowUp, same store action as drag & drop) and asserts the
 * panel reflects the new order.
 */

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const getFutureTimeToday = (): string => {
  const now = new Date();
  const future = new Date(now.getTime() + TWO_HOURS_MS);
  if (future.getDate() !== now.getDate()) {
    // Close to midnight: clamp to the last minutes of today.
    return '23:59';
  }
  const hh = String(future.getHours()).padStart(2, '0');
  const mm = String(future.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

test.describe('Later Today: subtask order (#9614)', () => {
  test('reordering subtasks is reflected in the Later Today panel', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const parentName = `${testPrefix}-EndOfDay`;
    await workViewPage.addTask(parentName);
    const parent = taskPage.getTaskByText(parentName).first();
    await expect(parent).toBeVisible();

    await workViewPage.addSubTask(parent, `${testPrefix}-Sub1`);
    await workViewPage.addSubTask(parent, `${testPrefix}-Sub2`);
    await workViewPage.addSubTask(parent, `${testPrefix}-Sub3`);
    await expect(taskPage.getSubTasks(parent)).toHaveCount(3);

    // Schedule the parent for later today via the schedule dialog ('s').
    await parent.focus();
    await expect(parent).toBeFocused();
    await page.keyboard.press('s');

    const scheduleDialog = page.locator('dialog-schedule-task');
    await expect(scheduleDialog).toBeVisible({ timeout: 10000 });

    const todayCell = scheduleDialog.locator('.mat-calendar-body-today').first();
    await expect(todayCell).toBeVisible();
    await todayCell.click();

    const timeInput = scheduleDialog.locator('input[type="time"]');
    await timeInput.waitFor({ state: 'visible', timeout: 10000 });
    await timeInput.fill(getFutureTimeToday());

    await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // The parent now lives in the "Later Today" panel.
    const laterTodayList = page.locator('task-list[listModelId="LATER_TODAY"]');
    await expect(laterTodayList).toBeVisible({ timeout: 10000 });
    const parentInPanel = laterTodayList
      .locator('task')
      .filter({ hasText: parentName })
      .first();
    await expect(parentInPanel).toBeVisible();

    const subTaskTitles = parentInPanel.locator('.sub-tasks task task-title');
    await expect(subTaskTitles).toHaveText(
      [`${testPrefix}-Sub1`, `${testPrefix}-Sub2`, `${testPrefix}-Sub3`],
      { timeout: 10000 },
    );

    // Move Sub3 to the top (2x Ctrl+Shift+ArrowUp) - dispatches moveSubTaskUp,
    // which mutates parent.subTaskIds exactly like drag & drop does.
    const sub3 = taskPage
      .getSubTasks(parentInPanel)
      .filter({ hasText: `${testPrefix}-Sub3` })
      .first();
    await sub3.focus();
    await expect(sub3).toBeFocused();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Shift+ArrowUp');

    // The panel must reflect the new order. Before the fix it kept showing
    // the original creation order even though subTaskIds had changed.
    await expect(subTaskTitles).toHaveText(
      [`${testPrefix}-Sub3`, `${testPrefix}-Sub1`, `${testPrefix}-Sub2`],
      { timeout: 10000 },
    );
  });
});
