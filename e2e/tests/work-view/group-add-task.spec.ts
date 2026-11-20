import { expect, test } from '../../fixtures/test.fixture';

test('group header "+" adds a task into that group, expanding it first', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Inbox task');
  await projectPage.createProject('Errands');
  await projectPage.navigateToProjectByName('Errands');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Errand task');
  await taskPage.getTaskByText('Errand task').focus();
  await page.keyboard.press('Shift+T');

  // Today: the bar's default (today) and the group's project both apply.
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  await page.locator('.task-filter-btn').click();
  await page.locator('.mat-mdc-menu-item', { hasText: 'Group By' }).click();
  await page.locator('.mat-mdc-menu-item', { hasText: 'Project' }).last().click();
  await page.keyboard.press('Escape');

  const errandsGroup = page.locator('work-view collapsible.is-group').filter({
    has: page.locator('.collapsible-title', { hasText: 'Errands' }),
  });
  const header = errandsGroup.locator(':scope > .collapsible-header');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');

  await header.getByRole('button', { name: /^Add task to .*Errands$/ }).click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  const input = errandsGroup.locator('add-task-bar .main-input');
  await input.fill('Added via group');
  await input.press('Enter');

  await expect(errandsGroup.locator('task .task-title')).toHaveText([
    /Added via group/,
    /Errand task/,
  ]);
});
