import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import {
  gotoHashRoute,
  openRecurDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';
import { waitForStatePersistence } from '../../utils/waits';
import { type TaskPage } from '../../pages/task.page';
import { type WorkViewPage } from '../../pages/work-view.page';

const START_DATE = new Date('2026-06-15T09:00:00');
const NEXT_DATE = new Date('2026-06-16T09:00:00');
const FOLLOWING_DATE = new Date('2026-06-17T09:00:00');
const NEXT_DAY = '2026-06-16';
const FOLLOWING_DAY = '2026-06-17';

const getProjection = (page: Page, day: string, taskTitle: string): Locator =>
  page
    .locator(`planner-day[data-day="${day}"] planner-repeat-projection`)
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

test.describe('Recurring task occurrence and series removal persistence', () => {
  test('skipping a future Daily occurrence persists and the series resumes the following day', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-SkipFutureDaily`;
    const controlTitle = `${testPrefix}-DailyControlSkip`;

    await page.clock.setSystemTime(START_DATE);
    await page.reload();
    await workViewPage.waitForTaskList();

    const task = await createDailyTask(page, workViewPage, taskPage, taskTitle);
    const controlTask = await createDailyTask(page, workViewPage, taskPage, controlTitle);

    await taskPage.markTaskAsDone(task);
    await taskPage.markTaskAsDone(controlTask);
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);
    await waitForStatePersistence(page);

    const skippedProjection = getProjection(page, NEXT_DAY, taskTitle);
    const followingProjection = getProjection(page, FOLLOWING_DAY, taskTitle);
    await gotoHashRoute(page, '/#/planner', skippedProjection.first());
    await expect(skippedProjection).toHaveCount(1, { timeout: 15000 });
    await expect(followingProjection).toHaveCount(1, { timeout: 15000 });

    await skippedProjection.click();
    const repeatDialog = page.locator('mat-dialog-container');
    await expect(repeatDialog).toBeVisible({ timeout: 10000 });
    await repeatDialog
      .getByRole('button', { name: 'Skip for 16/6', exact: true })
      .click();
    const skipConfirmation = page
      .locator('mat-dialog-container')
      .filter({ hasText: 'Skip the recurring task' });
    await expect(skipConfirmation).toBeVisible({ timeout: 5000 });
    await skipConfirmation.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    await expect(skippedProjection).toHaveCount(0, { timeout: 10000 });
    await expect(followingProjection).toHaveCount(1, { timeout: 10000 });
    await waitForStatePersistence(page);

    await page.reload();
    await expect(page.locator(`planner-day[data-day="${NEXT_DAY}"]`).first()).toBeVisible(
      {
        timeout: 15000,
      },
    );
    await expect(followingProjection).toHaveCount(1);
    await expect(skippedProjection).toHaveCount(0);

    await page.clock.setSystemTime(NEXT_DATE);
    await page.reload();
    await gotoHashRoute(page, '/#/tag/TODAY/tasks', page.locator('task-list').first());
    await workViewPage.waitForTaskList();
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: controlTitle }).first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);

    await page.clock.setSystemTime(FOLLOWING_DATE);
    await page.reload();
    await workViewPage.waitForTaskList();
    const resumedTask = taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first();
    await expect(resumedTask).toBeVisible({ timeout: 60000 });
    const resumedPlannerTask = page
      .locator(`planner-day[data-day="${FOLLOWING_DAY}"] planner-task`)
      .filter({ hasText: taskTitle });
    await gotoHashRoute(page, '/#/planner', resumedPlannerTask.first());
    await expect(resumedPlannerTask).toHaveCount(1, { timeout: 15000 });
  });

  test('removing a Daily series persists and prevents future task regeneration', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-RemoveDailySeries`;
    const controlTitle = `${testPrefix}-DailyControlRemove`;

    await page.clock.setSystemTime(START_DATE);
    await page.reload();
    await workViewPage.waitForTaskList();

    const task = await createDailyTask(page, workViewPage, taskPage, taskTitle);
    const controlTask = await createDailyTask(page, workViewPage, taskPage, controlTitle);
    const nextProjection = getProjection(page, NEXT_DAY, taskTitle);
    const followingProjection = getProjection(page, FOLLOWING_DAY, taskTitle);
    const controlProjection = getProjection(page, NEXT_DAY, controlTitle);

    await waitForStatePersistence(page);
    await gotoHashRoute(page, '/#/planner', nextProjection.first());
    await expect(nextProjection).toHaveCount(1, { timeout: 15000 });
    await page.reload();
    await expect(nextProjection).toHaveCount(1, { timeout: 15000 });
    await gotoHashRoute(page, '/#/tag/TODAY/tasks', task);
    await taskPage.openTaskDetail(task);

    const repeatValue = page.locator('task-detail-item .schedule-value__repeat');
    await expect(repeatValue).toContainText('Every day');

    const repeatDialog = await openRecurDialog(page);
    await repeatDialog.getByRole('button', { name: 'Remove', exact: true }).click();
    const removeConfirmation = page
      .locator('mat-dialog-container')
      .filter({ hasText: 'Removing the recurring config' });
    await expect(removeConfirmation).toBeVisible({ timeout: 5000 });
    await removeConfirmation
      .getByRole('button', { name: 'Remove completely', exact: true })
      .click();
    await expect(removeConfirmation).toBeHidden({ timeout: 10000 });

    await expect(task).toBeVisible();
    await expect(repeatValue).toHaveCount(0, {
      timeout: 10000,
    });
    await page.keyboard.press('Escape');

    await taskPage.markTaskAsDone(task);
    await taskPage.markTaskAsDone(controlTask);
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);
    await waitForStatePersistence(page);

    await gotoHashRoute(page, '/#/planner', controlProjection.first());
    await expect(controlProjection).toHaveCount(1, { timeout: 15000 });
    await expect(nextProjection).toHaveCount(0);
    await expect(followingProjection).toHaveCount(0);

    await page.reload();
    await expect(controlProjection).toHaveCount(1, { timeout: 15000 });
    await expect(nextProjection).toHaveCount(0);
    await expect(followingProjection).toHaveCount(0);

    await page.clock.setSystemTime(NEXT_DATE);
    await page.reload();
    await gotoHashRoute(page, '/#/tag/TODAY/tasks', page.locator('task-list').first());
    await workViewPage.waitForTaskList();
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: controlTitle }).first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskTitle })).toHaveCount(0);
  });
});
