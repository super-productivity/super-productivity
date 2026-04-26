import { Locator, Page } from 'playwright/test';

import { expect, test } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('Task time visibility', () => {

  const addTaskAndFillEstimatedTime = async (
    workViewPage: WorkViewPage,
    page: Page,
  ): Promise<void> => {
    await workViewPage.waitForTaskList();

    await workViewPage.addTask('task');
    await page.getByText(/task/).first().hover();
    await page.getByRole('button', { name: 'Show/Hide additional info' }).click();

    const durationInput: Locator = page.locator('.mat-ripple.ripple').first();
    await durationInput.click();
    const timeSpentInput: Locator = page.getByText('Estimate');
    await timeSpentInput.fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
  };

  test('Task time data should be invisible on hover', async ({ page, workViewPage }) => {
    await addTaskAndFillEstimatedTime(workViewPage, page);

    const timeWrapper = page.locator('.time-wrapper');
    await expect(timeWrapper).toBeVisible({ timeout: 3000 });
    await page.getByText(/task/).first().hover();
    await expect(timeWrapper).not.toBeVisible({ timeout: 3000 });
  });
});
