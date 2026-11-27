import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * An archived task found through Search can be brought back from its details
 * dialog, without looking it up again in History (2026-11 user survey: "could
 * not find completed or archived tasks" / "wanted to undo a mistake").
 */

const finishDay = async (page: Page): Promise<void> => {
  await page.locator('.e2e-finish-day').click();
  await page.waitForURL(/daily-summary/);
  const saveBtn = page.locator(
    'daily-summary button[mat-flat-button][color="primary"]:last-of-type',
  );
  // Archiving navigates back to Today asynchronously; wait for it to settle.
  await Promise.all([
    page.waitForURL(/#\/tag\/TODAY\/tasks/, { timeout: 15000 }),
    saveBtn.click(),
  ]);
  await expect(page.locator('task-list').first()).toBeVisible();
};

const searchIncludingCompleted = async (page: Page, term: string): Promise<Locator> => {
  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  await page.locator('search-page .search-field input').fill(term);
  await page.locator('search-page .include-completed-toggle input').check();
  return page.locator('search-page mat-list-item').filter({ hasText: term });
};

test.describe('Global Search: restore an archived task', () => {
  test('restores an archived task from its details dialog', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-ArchivedByMistake`;
    await workViewPage.addTask(taskName);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskName));
    await finishDay(page);
    await expect(taskPage.getTaskByText(taskName)).toHaveCount(0);

    const archivedResult = await searchIncludingCompleted(page, taskName);
    await expect(archivedResult).toHaveCount(1);
    await archivedResult.locator('.view-details-btn').click();

    const detailsDialog = page.locator('dialog-view-archived-task');
    await expect(detailsDialog).toContainText(taskName);
    // Activated by keyboard: the action must not need a pointer.
    await detailsDialog.locator('.e2e-restore-archived-task').focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog-confirm [e2e="confirmBtn"]').click();

    // The dialog closes and the task is back in the list as an open task.
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/tasks/);
    await expect(detailsDialog).toHaveCount(0);
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskName })).toHaveCount(1);

    // Search no longer lists it as archived. Search reads the archive once when
    // it opens and the restore leaves the archive asynchronously, so reopen it
    // until the archived copy is gone.
    await expect(async () => {
      await page.goto('/#/tag/TODAY/tasks');
      await workViewPage.waitForTaskList();
      const restoredResult = await searchIncludingCompleted(page, taskName);
      await expect(restoredResult).toHaveCount(1, { timeout: 2000 });
      await expect(restoredResult.locator('.view-details-btn')).toHaveCount(0, {
        timeout: 2000,
      });
    }).toPass({ timeout: 15000 });
  });
});
