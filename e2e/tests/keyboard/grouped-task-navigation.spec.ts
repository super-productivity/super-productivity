import { expect, test } from '../../fixtures/test.fixture';

test('navigates across project group headers with configured task shortcuts', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Inbox task');
  await projectPage.createProject('Navigation project');
  await projectPage.navigateToProjectByName('Navigation project');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Project task');
  const projectTask = taskPage.getTaskByText('Project task');
  await projectTask.focus();
  await page.keyboard.press('Shift+T');

  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  await expect(projectTask).toHaveCount(1);
  await expect(projectTask).toBeVisible();
  await page.locator('.task-filter-btn').click();
  await page.locator('.mat-mdc-menu-item', { hasText: 'Group By' }).click();
  await page.locator('.mat-mdc-menu-item', { hasText: 'Project' }).last().click();
  await page.keyboard.press('Escape');

  const groups = page.locator('work-view collapsible.is-group');
  await expect(groups).toHaveCount(2);
  const firstTask = groups.nth(0).locator('task').first();
  const secondHeader = groups.nth(1).locator(':scope > .collapsible-header');
  const secondTask = groups.nth(1).locator('task').first();
  await firstTask.focus();
  await page.keyboard.press('j');
  await expect(secondHeader).toBeFocused();
  await page.keyboard.press('j');
  await expect(secondTask).toBeFocused();
  await page.keyboard.press('k');
  await expect(secondHeader).toBeFocused();
  await page.keyboard.press('k');
  await expect(firstTask).toBeFocused();

  // A collapsed group still participates in navigation, but its tasks do not.
  await secondHeader.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(secondHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(secondTask).toHaveCount(0);
  await page.keyboard.press('k');
  await expect(firstTask).toBeFocused();
  await page.keyboard.press('j');
  await expect(secondHeader).toBeFocused();
});
