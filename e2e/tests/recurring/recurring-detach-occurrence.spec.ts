import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import {
  getRepeatSeriesView,
  gotoHashRoute,
  gotoToday,
  openRecurDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';
import { waitForStatePersistence } from '../../utils/waits';
import { type TaskPage } from '../../pages/task.page';
import { type WorkViewPage } from '../../pages/work-view.page';

/**
 * https://github.com/super-productivity/super-productivity/issues/11694
 *
 * "Separate task for <date>" in the dialog of a projected occurrence skips
 * that day in the series and adds a normal task for it: no link to the series
 * and no `rpt_` id, so the series neither moves nor duplicates it.
 */

const START_DATE = new Date('2026-06-15T09:00:00');
const DETACHED_DATE = new Date('2026-06-16T09:00:00');
const FOLLOWING_DATE = new Date('2026-06-17T09:00:00');
const DETACHED_DAY = '2026-06-16';
const FOLLOWING_DAY = '2026-06-17';

const getProjection = (page: Page, day: string, taskTitle: string): Locator =>
  page
    .locator(`planner-day[data-day="${day}"] planner-repeat-projection`)
    .filter({ hasText: taskTitle });

const getPlannerTask = (page: Page, day: string, taskTitle: string): Locator =>
  page
    .locator(`planner-day[data-day="${day}"] planner-task`)
    .filter({ hasText: taskTitle });

const createDailyTask = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskPage: TaskPage,
  taskTitle: string,
): Promise<Locator> => {
  await workViewPage.addTask(taskTitle);
  const task = taskPage.getTaskByText(taskTitle).first();
  await expect(task).toBeVisible({ timeout: 10000 });
  await taskPage.openTaskDetail(task);
  await openRecurDialog(page);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');
  return task;
};

/** The tasks of the series title that are due on `day`. */
const getTasksDueOn = async (
  page: Page,
  taskTitle: string,
  day: string,
): Promise<{ repeatCfgId: string | null; isSeriesId: boolean }[]> =>
  (await getRepeatSeriesView(page, taskTitle)).tasks
    .filter((task) => task.dueDay === day)
    .map((task) => ({
      repeatCfgId: task.repeatCfgId,
      isSeriesId: task.id.startsWith('rpt_'),
    }));

test.describe('Recurring task: turn one future occurrence into a normal task (#11694)', () => {
  test('detaching a future Daily occurrence leaves one normal task and the series resumes the next day', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-DetachFutureDaily`;
    const controlTitle = `${testPrefix}-DailyControlDetach`;

    await page.clock.setSystemTime(START_DATE);
    await page.reload();
    await workViewPage.waitForTaskList();

    const task = await createDailyTask(page, workViewPage, taskPage, taskTitle);
    const controlTask = await createDailyTask(page, workViewPage, taskPage, controlTitle);

    await taskPage.markTaskAsDone(task);
    await taskPage.markTaskAsDone(controlTask);
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);
    await waitForStatePersistence(page);

    const detachedProjection = getProjection(page, DETACHED_DAY, taskTitle);
    const followingProjection = getProjection(page, FOLLOWING_DAY, taskTitle);
    const detachedTask = getPlannerTask(page, DETACHED_DAY, taskTitle);
    await gotoHashRoute(page, '/#/planner', detachedProjection.first());
    await expect(detachedProjection).toHaveCount(1, { timeout: 15000 });
    await expect(followingProjection).toHaveCount(1, { timeout: 15000 });
    await expect(detachedTask).toHaveCount(0);

    // 1. Detach: one click, no confirmation.
    await detachedProjection.click();
    const repeatDialog = page.locator('mat-dialog-container');
    await expect(repeatDialog).toBeVisible({ timeout: 10000 });
    await repeatDialog
      .getByRole('button', { name: 'Separate task for 16/06', exact: true })
      .click();
    await expect(page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    // 2. The projection became a task on that day; the series goes on.
    await expect(detachedProjection).toHaveCount(0, { timeout: 10000 });
    await expect(detachedTask).toHaveCount(1, { timeout: 10000 });
    await expect(followingProjection).toHaveCount(1, { timeout: 10000 });
    expect(await getTasksDueOn(page, taskTitle, DETACHED_DAY)).toEqual([
      { repeatCfgId: null, isSeriesId: false },
    ]);
    await waitForStatePersistence(page);

    // 3. It survives a reload.
    await page.reload();
    await expect(detachedTask).toHaveCount(1, { timeout: 15000 });
    await expect(followingProjection).toHaveCount(1);
    await expect(detachedProjection).toHaveCount(0);

    // 4. When the day arrives the series creates nothing next to it.
    await page.clock.setSystemTime(DETACHED_DATE);
    await page.reload();
    await gotoToday(page);
    await workViewPage.waitForTaskList();
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: controlTitle }).first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(1);
    expect(await getTasksDueOn(page, taskTitle, DETACHED_DAY)).toEqual([
      { repeatCfgId: null, isSeriesId: false },
    ]);

    // 5. The series resumes the following day.
    await page.clock.setSystemTime(FOLLOWING_DATE);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect
      .poll(async () => await getTasksDueOn(page, taskTitle, FOLLOWING_DAY), {
        timeout: 60000,
      })
      .toEqual([{ repeatCfgId: expect.any(String), isSeriesId: true }]);
    expect(await getTasksDueOn(page, taskTitle, DETACHED_DAY)).toEqual([
      { repeatCfgId: null, isSeriesId: false },
    ]);
  });
});
