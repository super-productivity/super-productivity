import { expect, test } from '../../fixtures/test.fixture';
import { scheduleTaskForDay } from '../../utils/schedule-task-helper';

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
