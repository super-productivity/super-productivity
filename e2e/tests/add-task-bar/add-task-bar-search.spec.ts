import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * A user reported that search from the add-task bar "does nothing" (screenshot
 * from a phone, but not mobile-specific): in a project context, search only
 * covered that project's backlog, so tasks from other projects were never found,
 * and an empty result opened no panel at all.
 *
 * Run: npm run e2e:file e2e/tests/add-task-bar/add-task-bar-search.spec.ts -- --retries=0
 */

const openSearch = async (page: Page): Promise<void> => {
  const input = page.locator('add-task-bar.global .main-input');
  if (!(await input.isVisible())) {
    await page.locator('.tour-addBtn').click();
  }
  await expect(input).toBeVisible();
  const toggle = page.locator('add-task-bar.global .search-toggle-btn');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
};

test.describe('Add-task-bar search', () => {
  test('finds a task from another project in a project context and moves it here', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Sample Task Charlie');
    await page.keyboard.press('Escape');

    await projectPage.createProject('Test List');
    await projectPage.navigateToProjectByName('Test List');
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText('Sample Task Charlie')).toHaveCount(0);

    await openSearch(page);
    await page.keyboard.type('charlie');

    const option = page
      .locator('.add-task-bar-panel mat-option')
      .filter({ hasText: 'Sample Task Charlie' });
    await expect(option).toBeVisible();
    await option.click();

    await expect(taskPage.getTaskByText('Sample Task Charlie')).toBeVisible();

    // moved, not copied: the task is gone from its source project
    await page.keyboard.press('Escape');
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText('Sample Task Charlie')).toHaveCount(0);
  });

  test('shows a "no matches" row when nothing is found', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();

    await openSearch(page);
    await page.keyboard.type('zzz-nothing-matches-this');

    const noMatches = page
      .locator('.add-task-bar-panel mat-option')
      .filter({ hasText: 'No matching tasks or issues' });
    await expect(noMatches).toBeVisible();
    await expect(noMatches).toHaveAttribute('aria-disabled', 'true');
  });
});
