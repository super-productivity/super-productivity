import { expect, test } from '../../fixtures/test.fixture';

test('worklog export lists the time per project for the range', async ({
  page,
  workViewPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  // time on the default project (Inbox)
  await workViewPage.addTask(`${testPrefix}-Inbox work 30m/1h`);

  await projectPage.createProject('Client');
  await projectPage.navigateToProjectByName('Client');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(`${testPrefix}-Client work 90m/2h`);

  // History on Today covers every project
  await page.goto('/#/tag/TODAY/history');
  await page.locator('.week-header button').first().click();

  const dialog = page.locator('dialog-worklog-export');
  const header = dialog.locator('.collapsible-header', { hasText: 'Time per project' });
  // click, not focus + Enter: the dialog's autoFocus lands on its first select
  // after the open animation and would take the Enter
  await header.click();

  const rows = dialog.locator('.project-totals tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(`${testPrefix}-Client`);
  await expect(rows.nth(0)).toContainText('1h 30m');
  await expect(rows.nth(0)).toContainText('75%');
  await expect(rows.nth(1)).toContainText('Inbox');
  await expect(rows.nth(1)).toContainText('30m');
  await expect(rows.nth(1)).toContainText('25%');
});
