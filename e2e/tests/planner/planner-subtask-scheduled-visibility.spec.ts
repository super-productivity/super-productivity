import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

const QUICK_ACCESS_BUTTON = '.quick-access button';

/**
 * Schedule a task for a quick-access day (day-only, no time) via the keyboard
 * shortcut ('S' opens the schedule dialog for the focused task) and the
 * dialog's quick-access buttons (Today=0, Tomorrow=1, Next Week=2, Next
 * Month=3). onQuickAccessClick auto-submits, so clicking a day both sets the
 * due day and closes the dialog.
 *
 * The keyboard path is used deliberately: it is independent of whether the task
 * is already scheduled (a scheduled task's detail item shows a "Reschedule"
 * control instead of "Schedule Task") and of task height (hovering a parent
 * with sub-tasks lands on a sub-task row).
 */
const scheduleTaskForQuickDay = async (
  page: Page,
  task: Locator,
  quickAccessIndex: number,
): Promise<void> => {
  await task.scrollIntoViewIfNeeded();
  await task.focus();
  await expect(task).toBeFocused();

  await page.keyboard.press('s');

  const scheduleDialog = page.locator('dialog-schedule-task');
  await expect(scheduleDialog).toBeVisible({ timeout: 10000 });
  // No time set -> this creates a date-only dueDay, not a timed dueWithTime.
  await expect(scheduleDialog.locator('input[type="time"]')).toHaveValue('');

  await scheduleDialog.locator(QUICK_ACCESS_BUTTON).nth(quickAccessIndex).click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });
};

const getTomorrowDateString = (): string => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

test.describe('Planner: scheduled subtask visibility (#9019)', () => {
  test('keeps a date-only subtask visible on its own day after planning its parent', async ({
    page,
    plannerPage,
    taskPage,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent 9019');

    const parentTask = taskPage.getTaskByText('Parent 9019').first();
    await expect(parentTask).toBeVisible();
    await workViewPage.addSubTask(parentTask, 'Sub 9019');

    const subTask = taskPage
      .getSubTasks(parentTask)
      .filter({ hasText: 'Sub 9019' })
      .first();
    await expect(subTask).toBeVisible();

    // Schedule the SUBTASK for tomorrow (day-only).
    await scheduleTaskForQuickDay(page, subTask, 1);

    // Plan the PARENT for a different day (next week). Before #9019 this removed
    // the subtask from EVERY planner day, so it vanished from the planner.
    await scheduleTaskForQuickDay(page, parentTask, 2);

    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    const subTaskDay = page.locator(`planner-day[data-day="${getTomorrowDateString()}"]`);
    await expect(subTaskDay).toBeVisible({ timeout: 15000 });
    await expect(
      subTaskDay.locator('planner-task').filter({ hasText: 'Sub 9019' }),
    ).toBeVisible({ timeout: 15000 });
  });
});
