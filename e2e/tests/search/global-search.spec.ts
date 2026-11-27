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

  test('completes consecutive results without leaving search or losing the query', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const first = `${testPrefix}-first`;
    const second = `${testPrefix}-second`;
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);

    await openGlobalSearch(page);
    const search = page.locator('search-page');
    const query = search.getByRole('textbox');
    const rows = search.locator('mat-list-item');
    await query.fill(testPrefix);
    await search
      .getByRole('button', { name: `Mark as completed ${first}`, exact: true })
      .click();
    await expect(rows.filter({ hasText: first })).toHaveCount(0);
    await expect(query).toHaveValue(testPrefix);

    await search
      .getByRole('checkbox', { name: 'Include completed and archived tasks' })
      .check();
    await expect(rows.filter({ hasText: first }).locator('.task-done')).toBeVisible();
    await search
      .getByRole('button', { name: `Mark as completed ${second}`, exact: true })
      .press('Enter');
    await expect(rows.filter({ hasText: second }).locator('.task-done')).toBeVisible();
    await expect(search.getByRole('button', { name: /Mark as completed/ })).toHaveCount(
      0,
    );
    await expect(query).toHaveValue(testPrefix);
    await expect(page).toHaveURL(/\/#\/search$/);
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
