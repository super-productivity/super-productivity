import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import {
  closeRecentlyDeleted,
  deleteTaskViaContextMenu,
  expectRecentlyDeletedStoredCount,
  openRecentlyDeleted,
  RECENTLY_DELETED,
} from '../../utils/recently-deleted-helpers';

/**
 * Recently deleted (#2778): a deleted task can be recovered after the undo
 * snack is gone — here even after a reload — from the quiet link at the
 * bottom of History.
 */
test.describe('Recently deleted', () => {
  test('restores a deleted task with its subtask after a reload', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const parentTitle = `${testPrefix}-Trash parent`;
    const childTitle = `${testPrefix}-Trash child`;
    await workViewPage.addTask(parentTitle);
    const parent = taskPage.getTaskByText(parentTitle).first();
    await expect(parent).toBeVisible();
    await workViewPage.addSubTask(parent, childTitle);
    await expect(
      page.locator('.sub-tasks task').filter({ hasText: childTitle }),
    ).toBeVisible();

    // Delete the parent (and with it the subtask) through the context menu.
    await deleteTaskViaContextMenu(page, parentTitle);
    // The trash write is fire-and-forget: let it land before reloading.
    await expectRecentlyDeletedStoredCount(page, 1);

    // The undo snack is long gone after a reload.
    await waitForStatePersistence(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText(parentTitle)).toHaveCount(0);

    await openRecentlyDeleted(page);
    const entry = page.locator(RECENTLY_DELETED.ENTRY).filter({ hasText: parentTitle });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(/\+1 subtask(?!s)/);

    await entry.locator(RECENTLY_DELETED.RESTORE_BTN).click();
    await expect(page.locator(RECENTLY_DELETED.ENTRY)).toHaveCount(0);
    await expect(page.locator(RECENTLY_DELETED.NONE)).toBeVisible();
    // The dialog also hides live tasks; the stored entry itself must be gone.
    await expectRecentlyDeletedStoredCount(page, 0);
    await closeRecentlyDeleted(page);

    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    const restored = taskPage.getTaskByText(parentTitle).first();
    await expect(restored).toBeVisible();
    await expect(
      restored.locator('.sub-tasks task').filter({ hasText: childTitle }),
    ).toBeVisible();
  });

  test('finds a deleted task via Search and restores it from the result', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Trash search`;
    await workViewPage.addTask(title);
    await expect(taskPage.getTaskByText(title)).toBeVisible();
    await deleteTaskViaContextMenu(page, title);
    // The delete message says where to look once Undo is gone.
    await expect(page.getByText('Search still finds it for 30 days')).toBeVisible();
    await expectRecentlyDeletedStoredCount(page, 1);

    await page.goto('/#/search');
    await page.locator('search-page .search-field input').fill(title);
    const result = page.locator('search-page mat-list-item').filter({ hasText: title });
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('Deleted');

    await result.click();
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/tasks/);
    await expect(taskPage.getTaskByText(title)).toBeVisible();
    await expectRecentlyDeletedStoredCount(page, 0);
  });

  test('empties the trash, and it stays empty after a reload', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Trash empty`;
    await workViewPage.addTask(title);
    await expect(taskPage.getTaskByText(title)).toBeVisible();
    await deleteTaskViaContextMenu(page, title);

    await openRecentlyDeleted(page);
    await expect(
      page.locator(RECENTLY_DELETED.ENTRY).filter({ hasText: title }),
    ).toBeVisible();

    await page.locator(RECENTLY_DELETED.EMPTY_BTN).click();
    await page.locator('dialog-confirm [e2e="confirmBtn"]').click();
    await expect(page.locator(RECENTLY_DELETED.ENTRY)).toHaveCount(0);
    await expect(page.locator(RECENTLY_DELETED.EMPTY_BTN)).toBeDisabled();
    await expectRecentlyDeletedStoredCount(page, 0);
    await closeRecentlyDeleted(page);

    await waitForStatePersistence(page);
    // Still on History: the reload lands there, not on a task list.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(RECENTLY_DELETED.LINK).waitFor({ state: 'visible' });
    await openRecentlyDeleted(page);
    await expect(page.locator(RECENTLY_DELETED.NONE)).toBeVisible();
    await expectRecentlyDeletedStoredCount(page, 0);
  });
});
