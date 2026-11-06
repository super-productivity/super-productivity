import { expect, test } from '../../fixtures/test.fixture';
import {
  gotoHashRoute,
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
  setRecurStartDate,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/11266
 *
 * A yearly "After I complete it…" series: its copy is completed, so the next
 * copy is a year after the completion. Days later the user moves "First one
 * on" forward to today.
 *
 * Expected: a new open copy appears in Today right away.
 * Bug:      the edit is ignored, since scheduling only counted from
 *           `lastTaskCreationDay` (the completion day) for these configs.
 */

const FIRST_DAY = new Date('2026-05-01T10:00:00');
const LATER_DAY = new Date('2026-05-11T10:00:00');
const LATER_DAY_DDMMYYYY = '11/05/2026';
const NEXT_DAY_DDMMYYYY = '12/05/2026';

test.describe('Recurring Task - Move first occurrence of an after-completion repeat to today (#11266)', () => {
  test('moving "First one on" past the last completion to today creates a copy in Today', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-AfterCompletion11266`;

    await page.clock.setFixedTime(FIRST_DAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Yearly after-completion series starting today; its first copy is the task itself.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);
    await setRecurQuickSetting(page, /After I complete it/i);
    await expect(page.locator('mat-option')).toHaveCount(0, { timeout: 5000 });
    await dialog.locator('.repeat-cycle mat-select').first().click();
    await page
      .locator('mat-option')
      .filter({ hasText: /^Years?$/ })
      .click();
    await expect(page.locator('mat-option')).toHaveCount(0, { timeout: 5000 });
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // 2. Complete the copy: the series now counts from today.
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskTitle).first());

    // 3. Ten days later: the next copy is a year away, so no open copy exists.
    await page.clock.setFixedTime(LATER_DAY);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);

    // 4. Move "First one on" forward to today via the done copy.
    const doneCopy = page.locator('task').filter({ hasText: taskTitle }).first();
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', doneCopy);
    await taskPage.openTaskDetail(doneCopy);
    const editDialog = await openRecurDialog(page);
    await expect(editDialog.locator('mat-select').first()).toContainText(
      /After I complete it/i,
    );
    await setRecurStartDate(page, LATER_DAY_DDMMYYYY);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // 5. An open copy must be in Today without waiting for a day change.
    await gotoHashRoute(page, '/#/tag/TODAY/tasks', page.locator('task').first());
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(
      1,
      { timeout: 15000 },
    );

    // 6. Move the date a day ahead: the open copy leaves Today.
    await taskPage.openTaskDetail(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }),
    );
    await openRecurDialog(page);
    await setRecurStartDate(page, NEXT_DAY_DDMMYYYY);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(
      0,
      { timeout: 15000 },
    );

    // 7. Move it back to today: the open copy follows it into Today.
    const openCopy = taskPage.getUndoneTasks().filter({ hasText: taskTitle });
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', openCopy);
    await taskPage.openTaskDetail(openCopy);
    await openRecurDialog(page);
    await setRecurStartDate(page, LATER_DAY_DDMMYYYY);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');
    // Reload: right after the hash change the project list is still shown, where
    // the copy is visible whatever its day.
    await page.goto('/#/tag/TODAY/tasks');
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(
      1,
      { timeout: 15000 },
    );
  });
});
