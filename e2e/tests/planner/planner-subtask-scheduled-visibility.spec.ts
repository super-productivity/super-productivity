import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Schedule a task for an exact day (day-only, no time) via the keyboard
 * shortcut ('S' opens the schedule dialog) and calendar.
 *
 * The keyboard path is used deliberately: it is independent of whether the task
 * is already scheduled (a scheduled task's detail item shows a "Reschedule"
 * control instead of "Schedule Task") and of task height (hovering a parent
 * with sub-tasks lands on a sub-task row).
 */
const scheduleTaskForDay = async (
  page: Page,
  task: Locator,
  targetDate: Date,
): Promise<void> => {
  await task.scrollIntoViewIfNeeded();
  await task.focus();
  await expect(task).toBeFocused();

  await page.keyboard.press('s');

  const scheduleDialog = page.locator('dialog-schedule-task');
  await expect(scheduleDialog).toBeVisible({ timeout: 10000 });
  // No time set -> this creates a date-only dueDay, not a timed dueWithTime.
  await expect(scheduleDialog.locator('input[type="time"]')).toHaveValue('');

  const today = new Date();
  if (
    targetDate.getMonth() !== today.getMonth() ||
    targetDate.getFullYear() !== today.getFullYear()
  ) {
    await scheduleDialog.getByRole('button', { name: /next month/i }).click();
  }

  const targetDay = scheduleDialog
    .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
    .filter({ hasText: new RegExp(`^\\s*${targetDate.getDate()}\\s*$`) })
    .first();
  await expect(targetDay).toBeVisible();
  await targetDay.click();
  await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });
};

const getDateWithDayOffset = (dayOffset: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date;
};

const getDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

test.describe('Planner: scheduled subtask visibility (#9019)', () => {
  test('keeps a date-only subtask visible on its own day after planning its parent', async ({
    page,
    plannerPage,
    taskPage,
    workViewPage,
  }) => {
    const subTaskDate = getDateWithDayOffset(1);
    const parentDate = getDateWithDayOffset(2);

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
    await scheduleTaskForDay(page, subTask, subTaskDate);

    // Plan the PARENT for the following day. Before #9019 this removed the
    // subtask from EVERY planner day, so it vanished from the planner.
    await scheduleTaskForDay(page, parentTask, parentDate);

    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    const subTaskDay = page.locator(
      `planner-day[data-day="${getDateString(subTaskDate)}"]`,
    );
    await expect(subTaskDay).toBeVisible({ timeout: 15000 });
    await expect(
      subTaskDay.locator('planner-task').filter({ hasText: 'Sub 9019' }),
    ).toBeVisible({ timeout: 15000 });
  });
});
