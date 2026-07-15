import { expect, test } from '../../fixtures/test.fixture';

const openGlobalSearch = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  await expect(page.locator('search-page')).toBeVisible();
};

test.describe('Global Search', () => {
  test('opens from the configured keyboard shortcut and focuses the search field', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    await openGlobalSearch(page);

    await expect(page.locator('search-page .search-field input')).toBeFocused();
  });

  test('finds an existing task and navigates to it', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-UniqueSearchResult`;
    await workViewPage.addTask(taskName);

    await openGlobalSearch(page);
    await page.locator('search-page .search-field input').fill(taskName);

    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/tasks/);
    await expect(taskPage.getTaskByText(taskName)).toBeVisible();
  });
});
