import { expect, test } from '../../fixtures/test.fixture';

test.use({ userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Electron/43.3.0' });

test('should load and create tasks in an Electron host without the desktop bridge', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  expect(await page.evaluate(() => 'ea' in window)).toBe(false);
  await expect(page.locator('body')).toHaveClass(/\bisWeb\b/);
  await expect(page.locator('body')).not.toHaveClass(/\bisElectron\b/);

  await workViewPage.addTask('Task in embedded web app');
  await expect(taskPage.getTaskByText('Task in embedded web app')).toBeVisible();
});
