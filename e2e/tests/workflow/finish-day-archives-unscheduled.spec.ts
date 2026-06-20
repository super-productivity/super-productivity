import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression guard for discussion #8463.
 *
 * Completing a task now records only `doneOn` and no longer stamps a `dueDay`.
 * An UNSCHEDULED completed task (one that was never on Today — e.g. a project
 * task, which gets no `dueDay` at creation) must therefore still:
 *   (a) appear in the Today "Done" list, and
 *   (b) be cleared to the archive on Finish Day.
 * Both are driven by `isDone`/`doneOn`, not `dueDay`. If a future change scopes
 * the Today Done list or the finish-day archive by `dueDay`, this test fails.
 */

const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';

test.describe('Finish Day archives unscheduled completed tasks (#8463)', () => {
  test('completed inbox task shows in Today Done and is archived on finish day', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // A task created in a project context (here: the Inbox) gets no `dueDay` —
    // only the Today context stamps one at creation. So this exercises the
    // "unscheduled" completion path.
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-Unscheduled Done`;
    await workViewPage.addTask(taskName);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskName));
    await expect(taskPage.getDoneTasks().filter({ hasText: taskName })).toHaveCount(1);

    // (a) It appears in the Today "Done" list despite having no dueDay.
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await expect(taskPage.getDoneTasks().filter({ hasText: taskName })).toHaveCount(1);

    // (b) Finish Day moves it to the archive.
    await page.locator(FINISH_DAY_BTN).click();
    await page.waitForURL(/daily-summary/);
    await expect(page.locator('daily-summary')).toContainText('Unscheduled Done');
    await page.locator(SAVE_AND_GO_HOME_BTN).click();
    await page.waitForURL(/tag\/TODAY/);
    await workViewPage.waitForTaskList();

    // The Today Done list is the global active-isDone list, so the task being gone
    // from it proves it was archived, not merely hidden.
    await expect(taskPage.getTaskByText(taskName)).toHaveCount(0);
  });
});
