import { expect, type Page } from '@playwright/test';

/** Selectors for the Recently deleted trash (History → bottom link → dialog). */
export const RECENTLY_DELETED = {
  LINK: 'history .recently-deleted-btn',
  DIALOG: 'dialog-recently-deleted',
  ENTRY: 'dialog-recently-deleted .entry',
  RESTORE_BTN: '.restore-btn',
  EMPTY_BTN: 'dialog-recently-deleted .empty-btn',
  NONE: 'dialog-recently-deleted .none',
  CLOSE_BTN: 'dialog-recently-deleted button[mat-dialog-close]',
} as const;

/**
 * Rows in the device-local trash database, read straight from IndexedDB.
 * The dialog hides entries whose task is live again, so only this proves an
 * entry was really written or removed.
 */
export const getRecentlyDeletedStoredCount = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('SUP_RECENTLY_DELETED');
        open.onupgradeneeded = () => {
          // Not created yet: nothing was ever recorded. Create the store the
          // app expects so this probe does not leave an unusable database.
          open.result.createObjectStore('entries', { keyPath: 'id' });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction('entries').objectStore('entries').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      }),
  );

/** Recording is fire-and-forget, so poll for the stored count. */
export const expectRecentlyDeletedStoredCount = async (
  page: Page,
  expected: number,
): Promise<void> => {
  await expect.poll(() => getRecentlyDeletedStoredCount(page)).toBe(expected);
};

/** Deletes a task through its context menu and the default confirmation. */
export const deleteTaskViaContextMenu = async (
  page: Page,
  title: string,
): Promise<void> => {
  const task = page.locator('task').filter({ hasText: title }).first();
  await task.locator('task-title').first().click({ button: 'right' });
  await page.locator('.mat-mdc-menu-content button.color-warn').click();
  await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
  await expect(page.locator('task').filter({ hasText: title })).toHaveCount(0);
};

export const openRecentlyDeleted = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/tag/TODAY/history';
  });
  await page.locator(RECENTLY_DELETED.LINK).click();
  await page.locator(RECENTLY_DELETED.DIALOG).waitFor({ state: 'visible' });
};

export const closeRecentlyDeleted = async (page: Page): Promise<void> => {
  await page.locator(RECENTLY_DELETED.CLOSE_BTN).click();
  await page.locator(RECENTLY_DELETED.DIALOG).waitFor({ state: 'hidden' });
};
