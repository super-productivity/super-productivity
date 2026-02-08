import { Locator, Page } from 'playwright/test';

import { expect, test } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('Task detail', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  const addAndOpenIncompleteTask = async (
    workViewPage: WorkViewPage,
    page: Page,
  ): Promise<void> => {
    await workViewPage.waitForTaskList();

    await workViewPage.addTask('task');
    await page.getByText(/task/).first().hover();
    await page.getByRole('button', { name: 'Show/Hide additional info' }).click();
  };

  const addAndOpenCompleteTask = async (
    workViewPage: WorkViewPage,
    page: Page,
  ): Promise<void> => {
    await addAndOpenIncompleteTask(workViewPage, page);

    await page.getByText(/task/).first().hover();
    await page.getByRole('button', { name: 'Toggle completion status' }).click();
  };

  const findDateInfo = (page: Page, infoPrefix: string): Locator =>
    page.locator('.edit-date-info').filter({ hasText: new RegExp(infoPrefix) });

  test('should update created with a time change', async ({ page, workViewPage }) => {
    await addAndOpenIncompleteTask(workViewPage, page);

    const createdInfo = findDateInfo(page, 'Created');
    const createdInfoText = await createdInfo.textContent();
    await createdInfo.click();

    const timeInput = page.getByRole('combobox', { name: 'Time' });
    // Use fill() with a fixed valid time - simpler and more reliable than computing relative changes
    await timeInput.fill('11:59 PM');
    // Blur to trigger form update (ngModelOptions: updateOn: 'blur')
    await timeInput.press('Tab');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(createdInfo).not.toHaveText(createdInfoText!);
  });

  test('should update completed with a date change', async ({ page, workViewPage }) => {
    await addAndOpenCompleteTask(workViewPage, page);

    const completedInfo = await findDateInfo(page, 'Completed');
    const completedInfoText = await completedInfo.textContent();
    await completedInfo.click();

    await page.getByRole('button', { name: 'Open calendar' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    // Picking the first day of the next month should guarantee a change
    await page.locator('mat-month-view button').first().click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(completedInfo).not.toHaveText(completedInfoText!);
  });

  test('should update completed with a time change', async ({ page, workViewPage }) => {
    await addAndOpenCompleteTask(workViewPage, page);

    const completedInfo = findDateInfo(page, 'Completed');
    const completedInfoText = await completedInfo.textContent();
    await completedInfo.click();

    const timeInput = page.getByRole('combobox', { name: 'Time' });
    // Use fill() with a fixed valid time - simpler and more reliable than computing relative changes
    await timeInput.fill('11:59 PM');
    // Blur to trigger form update (ngModelOptions: updateOn: 'blur')
    await timeInput.press('Tab');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(completedInfo).not.toHaveText(completedInfoText!);
  });

  test('should prevent updating created with no datetime selection', async ({
    page,
    workViewPage,
  }) => {
    await addAndOpenIncompleteTask(workViewPage, page);

    await findDateInfo(page, 'Created').click();

    const dateInput = page.getByRole('textbox', { name: 'Date' });
    const timeInput = page.getByRole('combobox', { name: 'Time' });
    await dateInput.fill('');
    // Blur to trigger form update (ngModelOptions: updateOn: 'blur')
    await dateInput.press('Tab');
    await timeInput.fill('');
    await timeInput.press('Tab');

    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('should prevent updating completed with no datetime selection', async ({
    page,
    workViewPage,
  }) => {
    await addAndOpenCompleteTask(workViewPage, page);

    await findDateInfo(page, 'Completed').click();

    const dateInput = page.getByRole('textbox', { name: 'Date' });
    const timeInput = page.getByRole('combobox', { name: 'Time' });
    await dateInput.fill('');
    // Blur to trigger form update (ngModelOptions: updateOn: 'blur')
    await dateInput.press('Tab');
    await timeInput.fill('');
    await timeInput.press('Tab');

    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
