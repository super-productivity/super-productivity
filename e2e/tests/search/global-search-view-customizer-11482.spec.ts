import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * #11482: the reporter saw search results fail to reveal in sorted/grouped
 * views. Sort and grouping cases pin that scenario (they passed on master);
 * the reproduced failure was an active filter hiding the task, which used to
 * expire silently.
 */
const sortByName = async (page: Page): Promise<void> => {
  await page.locator('.task-filter-btn').click();
  const sortItem = page.locator('.mat-mdc-menu-item', { hasText: 'Sort' }).first();
  await expect(sortItem).toBeVisible();
  await sortItem.click();
  const nameOption = page.locator('.mat-mdc-menu-item', { hasText: 'Name' }).last();
  await expect(nameOption).toBeVisible();
  await nameOption.click();
  await page.keyboard.press('Escape');
};

test.describe('Global Search — customized view (#11482)', () => {
  test('reveals and focuses a task while the view is sorted', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-SortedTarget`;
    await workViewPage.addTask(`${testPrefix}-Other`);
    await workViewPage.addTask(taskName);

    const taskEl = taskPage.getTaskByText(taskName);
    await expect(taskEl).toBeVisible();
    const taskId = await taskEl.evaluate((el: HTMLElement) => {
      const host = el.closest('task') ?? el;
      return (host as HTMLElement).dataset.taskId ?? '';
    });
    expect(taskId).toBeTruthy();

    await sortByName(page);
    const taskRow = page.locator(`task[data-task-id="${taskId}"]`);
    await expect(taskRow).toBeVisible();

    await page.keyboard.press('Shift+F');
    await expect(page).toHaveURL(/\/#\/search$/);
    await page.locator('search-page .search-field input').fill(taskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(taskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${taskId}`);
  });

  /**
   * A filtered-out task has no row anywhere, so the reveal used to expire
   * silently. It must keep the filter, say why, and reveal on "Clear filter".
   */
  test('offers to clear a filter that hides the searched task', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-FilteredOut`;
    await workViewPage.addTask(taskName);
    const taskEl = taskPage.getTaskByText(taskName);
    await expect(taskEl).toBeVisible();
    const taskId = await taskEl.evaluate((el: HTMLElement) => {
      const host = el.closest('task') ?? el;
      return (host as HTMLElement).dataset.taskId ?? '';
    });

    await page.evaluate(() => {
      localStorage.setItem(
        'SUP_TASK_VIEW_CUSTOMIZER_BY_CONTEXT',
        JSON.stringify({
          ['TAG:TODAY']: {
            sort: { type: 'name', order: 'asc', label: 'x' },
            group: { type: null, label: 'x' },
            filter: { type: 'priority', preset: '3', label: 'x' },
            collapsedGroupIds: [],
          },
        }),
      );
    });
    await page.reload();
    await workViewPage.waitForTaskList();
    const taskRow = page.locator(`task[data-task-id="${taskId}"]`);
    await expect(taskRow).toHaveCount(0);

    await page.keyboard.press('Shift+F');
    await expect(page).toHaveURL(/\/#\/search$/);
    await page.locator('search-page .search-field input').fill(taskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    const snack = page.locator('snack-custom').filter({
      hasText: 'This task is hidden by the current filter',
    });
    await expect(snack).toBeVisible();
    // The filter stays until the user chooses to clear it.
    await expect(taskRow).toHaveCount(0);
    await snack.locator('button.action').click();

    await expect(taskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${taskId}`);
  });

  test('reveals a subtask of a collapsed parent while the view is sorted', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const parentName = `${testPrefix}-SortedParent`;
    const subTaskName = `${testPrefix}-SortedSubTask`;
    await workViewPage.addTask(`${testPrefix}-Other`);
    await workViewPage.addTask(parentName);
    const parentEl = taskPage.getTaskByText(parentName).first();
    await expect(parentEl).toBeVisible();
    await workViewPage.addSubTask(parentEl, subTaskName);

    const subTaskEl = parentEl.locator('.sub-tasks task').filter({
      hasText: subTaskName,
    });
    await expect(subTaskEl).toBeVisible();
    const subTaskId = await subTaskEl.getAttribute('data-task-id');
    expect(subTaskId).toBeTruthy();
    const subTaskRow = page.locator(`task[data-task-id="${subTaskId}"]`);

    await sortByName(page);
    await parentEl.locator('.toggle-sub-tasks-btn').first().click();
    await expect(subTaskRow).toHaveCount(0);

    await page.keyboard.press('Shift+F');
    await expect(page).toHaveURL(/\/#\/search$/);
    await page.locator('search-page .search-field input').fill(subTaskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: subTaskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(subTaskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${subTaskId}`);
  });

  test('reveals a task in a sorted project when searching from another context', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    await projectPage.createAndGoToTestProject();
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-ProjectSortedTarget`;
    for (let i = 0; i < 6; i++) {
      await workViewPage.addTask(`${testPrefix}-Filler-${i}`);
    }
    await workViewPage.addTask(taskName);

    const taskEl = taskPage.getTaskByText(taskName);
    await expect(taskEl).toBeVisible();
    const taskId = await taskEl.evaluate((el: HTMLElement) => {
      const host = el.closest('task') ?? el;
      return (host as HTMLElement).dataset.taskId ?? '';
    });
    expect(taskId).toBeTruthy();

    await sortByName(page);
    const taskRow = page.locator(`task[data-task-id="${taskId}"]`);
    await expect(taskRow).toBeVisible();

    // Leave the project so the search result has to route back into it.
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await expect(taskRow).toHaveCount(0);

    await page.keyboard.press('Shift+F');
    await expect(page).toHaveURL(/\/#\/search$/);
    await page.locator('search-page .search-field input').fill(taskName);
    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(page).toHaveURL(/\/#\/project\//);
    await expect(taskRow).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(`t-${taskId}`);
  });
});
