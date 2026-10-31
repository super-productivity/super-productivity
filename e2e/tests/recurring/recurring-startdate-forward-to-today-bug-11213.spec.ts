import { expect, test } from '../../fixtures/test.fixture';
import {
  gotoHashRoute,
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
  setRecurStartDate,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/11213
 *
 * An "on demand" yearly series: its only copy is completed, so the next copy
 * is a year away. Days later the user replans it by moving the repeat start
 * date forward to today.
 *
 * Expected: a new open copy appears in Today right away.
 * Bug:      nothing appears until the next day change, since
 *           `rescheduleTaskOnRepeatCfgUpdate$` only triggered `addAllDueToday()`
 *           when the start date moved earlier or the series was resumed.
 */

const FIRST_DAY = new Date('2026-05-01T10:00:00');
const LATER_DAY = new Date('2026-05-11T10:00:00');
const LATER_DAY_DDMMYYYY = '11/05/2026';

test.describe('Recurring Task - Move startDate forward to today (#11213)', () => {
  test('moving startDate forward to today after the last copy was done creates a copy in Today', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-OnDemand11213`;

    await page.clock.setFixedTime(FIRST_DAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Yearly series starting today; its first copy is the task itself.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    await setRecurQuickSetting(page, /Every year on/i);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // 2. Complete the only copy.
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskTitle).first());

    // 3. Ten days later: no occurrence today, so no open copy exists.
    await page.clock.setFixedTime(LATER_DAY);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);

    // 4. Replan: move the start date forward to today via the done copy.
    const doneCopy = page.locator('task').filter({ hasText: taskTitle }).first();
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', doneCopy);
    await taskPage.openTaskDetail(doneCopy);
    await openRecurDialog(page);
    await setRecurStartDate(page, LATER_DAY_DDMMYYYY);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // 5. An open copy must be in Today without waiting for a day change.
    await gotoHashRoute(page, '/#/tag/TODAY/tasks', page.locator('task').first());
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(
      1,
      { timeout: 15000 },
    );
  });
});
