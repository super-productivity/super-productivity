import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { getTaskTimeSpentFromState } from '../../utils/supersync-helpers';

const MIN_TRACKED_MS = 3000;

const countStoredOps = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('SUP_OPS');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('ops', 'readonly').objectStore('ops').count();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );

// Simulates switching away from the tab or backgrounding the app.
const hidePage = (page: Page): Promise<void> =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

// Tracked time is written in 5-minute batches; hiding the tab and then reloading
// or closing it inside a batch window used to drop everything tracked since the
// last write (reported by a web user).
test.describe('Time tracking persistence', () => {
  test('keeps tracked time when the tab is hidden and then reloaded', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Reload tracking task');
    const task = taskPage.getTaskByText('Reload tracking task');
    await expect(task).toBeVisible();

    const startBtn = task.locator('.start-task-btn');
    await expect(async () => {
      if (!(await task.evaluate((el) => el.classList.contains('isCurrent')))) {
        await task.hover();
        await startBtn.click({ timeout: 2000 });
      }
      await expect(task).toHaveClass(/\bisCurrent\b/, { timeout: 1000 });
    }).toPass({ timeout: 10000 });

    await expect
      .poll(() => getTaskTimeSpentFromState({ page }, 'Reload tracking task'), {
        timeout: 15000,
      })
      .toBeGreaterThanOrEqual(MIN_TRACKED_MS);

    const opsBeforeHide = await countStoredOps(page);
    await hidePage(page);
    await expect.poll(() => countStoredOps(page)).toBeGreaterThan(opsBeforeHide);

    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText('Reload tracking task')).toBeVisible();

    expect(
      await getTaskTimeSpentFromState({ page }, 'Reload tracking task'),
    ).toBeGreaterThanOrEqual(MIN_TRACKED_MS);
  });
});
