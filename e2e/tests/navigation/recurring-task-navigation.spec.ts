import { expect, test } from '../../fixtures/test.fixture';

test('opens Recurring Tasks from the sidebar without a project recurrence', async ({
  page,
  workViewPage,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await workViewPage.waitForTaskList();
  const recurringTasks = page.getByRole('menuitem', {
    name: 'Recurring Tasks',
    exact: true,
  });
  await expect(recurringTasks).toBeVisible();
  await recurringTasks.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/scheduled-list$/);
  await expect(page.locator('scheduled-list-page')).toBeVisible();
});

test('opens Recurring Tasks from the mobile drawer', async ({ page, workViewPage }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workViewPage.waitForTaskList();
  await page.goto('/#/planner');
  await expect(page.locator('planner')).toBeVisible();
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  await page
    .locator('mobile-bottom-nav')
    .getByRole('button', { name: 'Project Menu', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Recurring Tasks', exact: true }).click();
  await expect(page).toHaveURL(/\/scheduled-list$/);
  await expect(page.locator('scheduled-list-page')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/tag\/TODAY\/tasks$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/planner$/);
});
