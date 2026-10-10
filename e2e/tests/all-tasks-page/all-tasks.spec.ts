import { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

import { ProjectPage } from '../../pages';

test.describe('All Tasks Page', () => {
  //add 1 task to Today
  const addTaskToday = async (workViewPage: WorkViewPage): Promise<void> => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('E2E I 10m');
  };

  //add 2 project , each with 1 task
  const addProjectTasks = async (
    projectPage: ProjectPage,
    workViewPage: WorkViewPage,
    page: Page,
  ): Promise<void> => {
    await projectPage.createProject('ProjA');
    await projectPage.navigateToProjectByName('ProjA');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('E2E TA 10m');
    await page.keyboard.press('Escape');
    await projectPage.createProject('ProjB');
    await projectPage.navigateToProjectByName('ProjB');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('E2E TB 10m');
    await page.keyboard.press('Escape');
  };

  const openProjectFilter = async (page: Page): Promise<void> => {
    // Open filter menu
    await page.locator('.task-filter-btn').first().click();
    await page.getByRole('menuitem', { name: 'Filter By' }).click();

    // Use .last() to avoid matching the side-nav "Projects" group
    await page.getByRole('menuitem', { name: 'Project' }).last().click();
  };
  //filter menu should be open
  const toggleProjectFilter = async (page: Page, projectName: string): Promise<void> => {
    const projectAFilter = page
      .locator('button[mat-menu-item]')
      .filter({ hasText: projectName })
      .last();
    await projectAFilter.waitFor({ state: 'visible', timeout: 10000 });
    await projectAFilter.dispatchEvent('click');
  };

  //show tasks from 2 projects and inbox
  test('should show tasks from all projects on All Tasks page', async ({
    page,
    testPrefix,
    projectPage,
  }) => {
    test.setTimeout(120000);
    const workViewPage = new WorkViewPage(page, testPrefix);

    await addTaskToday(workViewPage);

    await addProjectTasks(projectPage, workViewPage, page);

    await page.goto('/#/all-tasks');
    await page.waitForURL('**/all-tasks');
    await workViewPage.waitForTaskList();

    const taskI = page.locator('task').filter({ hasText: 'E2E I' });
    const taskA = page.locator('task').filter({ hasText: 'E2E TA' });
    const taskB = page.locator('task').filter({ hasText: 'E2E TB' });
    await expect(taskI.first()).toBeVisible();
    await expect(taskA.first()).toBeVisible();
    await expect(taskB.first()).toBeVisible();
  });

  //test if filter works for 1 project and then 1 project and Inbox
  test('should filter tasks by multi-select project', async ({
    page,
    testPrefix,
    projectPage,
  }) => {
    test.setTimeout(120000);
    const workViewPage = new WorkViewPage(page, testPrefix);

    await addTaskToday(workViewPage);

    await addProjectTasks(projectPage, workViewPage, page);

    await page.goto('/#/all-tasks');
    await page.waitForURL('**/all-tasks');
    await workViewPage.waitForTaskList();

    const taskI = page.locator('task').filter({ hasText: 'E2E I' });
    const taskA = page.locator('task').filter({ hasText: 'E2E TA' });
    const taskB = page.locator('task').filter({ hasText: 'E2E TB' });
    await expect(taskI.first()).toBeVisible();
    await expect(taskA.first()).toBeVisible();
    await expect(taskB.first()).toBeVisible();

    await openProjectFilter(page);

    //filter to 1 project
    await toggleProjectFilter(page, `${testPrefix}-ProjA`);

    await expect(taskI.first()).not.toBeVisible();
    await expect(taskA.first()).toBeVisible();
    await expect(taskB.first()).not.toBeVisible();

    //filter to another 1 project and inbox
    await toggleProjectFilter(page, `${testPrefix}-ProjA`);
    await toggleProjectFilter(page, `${testPrefix}-ProjB`);
    await toggleProjectFilter(page, 'Inbox');

    await expect(taskI.first()).toBeVisible();
    await expect(taskA.first()).not.toBeVisible();
    await expect(taskB.first()).toBeVisible();
  });

  //estimated remaining time should count all tasks and update with project filtering
  test('should update estimate remaining when filtering by project', async ({
    page,
    testPrefix,
    projectPage,
  }) => {
    test.setTimeout(120000);
    const workViewPage = new WorkViewPage(page, testPrefix);

    await addTaskToday(workViewPage);

    await addProjectTasks(projectPage, workViewPage, page);

    await page.goto('/#/all-tasks');
    await page.waitForURL('**/all-tasks');
    await workViewPage.waitForTaskList();

    const taskI = page.locator('task').filter({ hasText: 'E2E I' });
    const taskA = page.locator('task').filter({ hasText: 'E2E TA' });
    const taskB = page.locator('task').filter({ hasText: 'E2E TB' });
    await expect(taskI.first()).toBeVisible();
    await expect(taskA.first()).toBeVisible();
    await expect(taskB.first()).toBeVisible();

    await openProjectFilter(page);

    //filter to 1 project
    await toggleProjectFilter(page, `${testPrefix}-ProjA`);

    await expect(taskI.first()).not.toBeVisible();
    await expect(taskA.first()).toBeVisible();
    await expect(taskB.first()).not.toBeVisible();

    const timeValLoc = page.locator('.status-bar .time-val').first();
    await expect(timeValLoc).toBeVisible();
    const initialText = await timeValLoc.textContent();
    await expect(initialText).toContain('10');

    //filter to another 1 project and inbox
    await toggleProjectFilter(page, `${testPrefix}-ProjA`);
    await toggleProjectFilter(page, `${testPrefix}-ProjB`);
    await toggleProjectFilter(page, 'Inbox');

    await expect(taskI.first()).toBeVisible();
    await expect(taskA.first()).not.toBeVisible();
    await expect(taskB.first()).toBeVisible();

    const filteredText = await timeValLoc.textContent();
    await expect(filteredText).toContain('20');
  });
});
