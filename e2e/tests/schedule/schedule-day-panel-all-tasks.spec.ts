import { expect, test } from '../../fixtures/test.fixture';

const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';

test.describe('Schedule day panel: "Show all tasks"', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('opens one list of all tasks beside the panel', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    await page.goto(INBOX_URL);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Plan me from the all tasks list');
    await page.locator('.e2e-toggle-schedule-day-panel').first().click();
    // the panel's pager also renders the neighbouring days
    const panel = page.locator('schedule-day-panel schedule-week').first();
    await expect(panel).toBeVisible();

    const link = page
      .locator('schedule-day-panel')
      .getByRole('button', { name: 'Show all tasks' })
      .first();
    await link.click();

    await expect(page).toHaveURL(/#\/boards\/.+/);
    await expect(
      page.locator('boards task').filter({ hasText: 'Plan me from the all tasks list' }),
    ).toBeVisible();
    // The panel stays open: the list is there to drag from.
    await expect(panel).toBeVisible();
    // Nothing to offer on the list itself.
    await expect(link).toBeHidden();
    const listUrl = page.url();

    // Asked for again, it is the same view, not a second one.
    await page.goto(INBOX_URL);
    await workViewPage.waitForTaskList();
    await link.click();
    await expect(page).toHaveURL(listUrl);
    await expect(
      page.locator('nav-view-group nav-item').filter({ hasText: 'All tasks' }),
    ).toHaveCount(1);

    await settingsPage.navigateToSettings();
    await expect(panel).toBeHidden();
  });
});
