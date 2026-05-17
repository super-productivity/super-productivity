import { Locator, Page } from '@playwright/test';

import { cssSelectors } from '../../constants/selectors';
import { expect, test } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages';

const { FIRST_TASK, SECOND_TASK, SUB_TASK, MAIN } = cssSelectors;

test.describe('Task time visibility', () => {
  const fillEstimatedTime = async (page: Page, time: number): Promise<void> => {
    // time-estimate/Duration position might need adjusting if detail-menu is changed
    const durationInput: Locator = page.locator(
      'task-detail-item:nth-child(3) > .input-item > .mat-ripple',
    );
    await durationInput.click();
    const timeSpentInput: Locator = page.getByText('Estimate', { exact: true });
    await timeSpentInput.fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
  };

  const addTaskAndFillEstimatedTime = async (
    workViewPage: WorkViewPage,
    page: Page,
    taskPage: TaskPage,
    taskName: string,
  ): Promise<void> => {
    await workViewPage.waitForTaskList();

    await workViewPage.addTask(taskName);
    const task = taskPage.getTaskByText(taskName);
    await taskPage.openTaskDetail(task);

    await fillEstimatedTime(page, 45);
    //close the detail page
    await taskPage.toggleTaskDetail(task);
  };

  const addSubtaskToTaskAndFillEstimatedTime = async (
    workViewPage: WorkViewPage,
    page: Page,
    taskPage: TaskPage,
    taskName: string,
    subName: string,
  ): Promise<void> => {
    await workViewPage.waitForTaskList();

    const task = taskPage.getTaskByText(taskName);
    await workViewPage.addSubTask(task, subName);
    const subTask = taskPage.getSubTasks(task);
    await taskPage.openTaskDetail(subTask);

    await fillEstimatedTime(page, 30);
  };

  test('Task time data should be invisible on hover', async ({ page, workViewPage, taskPage, }) => {
    await addTaskAndFillEstimatedTime(workViewPage, page, taskPage, 'task 1');
    //hover(MAIN) to reset mouse away from tasks
    await page.hover(MAIN);

    const timeWrapper = page.locator('.time-wrapper');
    await expect(timeWrapper).toBeVisible({ timeout: 3000 });
    await page.hover(FIRST_TASK);
    await expect(timeWrapper).not.toBeVisible({ timeout: 3000 });
  });

  test('Task time data should be invisible on hover only for specific task', async ({ page, workViewPage, taskPage, }) => {
    await addTaskAndFillEstimatedTime(workViewPage, page, taskPage, 'task 1');
    await addTaskAndFillEstimatedTime(workViewPage, page, taskPage, 'task 2');
    await page.hover(MAIN);

    const timeWrapper1 = page.locator('.time-wrapper').first();
    const timeWrapper2 = page.locator('.time-wrapper').last();
    await expect(timeWrapper1).toBeVisible({ timeout: 3000 });
    await expect(timeWrapper2).toBeVisible({ timeout: 3000 });
    await page.hover(FIRST_TASK);
    await expect(timeWrapper1).not.toBeVisible({ timeout: 3000 });
    await expect(timeWrapper2).toBeVisible({ timeout: 3000 });
    await page.hover(SECOND_TASK);
    await expect(timeWrapper2).not.toBeVisible({ timeout: 3000 });
    await expect(timeWrapper1).toBeVisible({ timeout: 3000 });
  });

  test('Task time data should be visible on hover if task has subtask', async ({ page, workViewPage, taskPage, }) => {
    await addTaskAndFillEstimatedTime(workViewPage, page, taskPage, 'task 1');
    await addSubtaskToTaskAndFillEstimatedTime(
      workViewPage,
      page,
      taskPage,
      'task 1',
      'subtask 1',
    );
    await page.hover(MAIN);

    const timeWrapper = page.locator('.time-wrapper').first();
    const timeWrapperSub = page.locator('.time-wrapper').last();
    await expect(timeWrapper).toBeVisible({ timeout: 3000 });
    await expect(timeWrapperSub).toBeVisible({ timeout: 3000 });
    await page.hover(FIRST_TASK);
    await expect(timeWrapper).toBeVisible({ timeout: 3000 });
    await expect(timeWrapperSub).toBeVisible({ timeout: 3000 });
    await page.hover(SUB_TASK);
    await expect(timeWrapper).toBeVisible({ timeout: 3000 });
    await expect(timeWrapperSub).not.toBeVisible({ timeout: 3000 });
  });
});
