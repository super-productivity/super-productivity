import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

/**
 * E2E Tests for issue #7032: Markdown link in task title breaks persistence.
 *
 * These tests verify that tasks with markdown link syntax in their titles
 * persist correctly through page reloads.
 *
 * Run with: npm run e2e:file e2e/tests/import-export/markdown-link-persistence.spec.ts
 */

const dismissViteOverlay = async (page: Page): Promise<void> => {
  const overlay = page.locator('vite-error-overlay');
  const isVisible = await overlay.isVisible().catch(() => false);
  if (isVisible) {
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
};

test.describe('@markdown-link Markdown link persistence (issue #7032)', () => {
  test('task with markdown link should survive reload', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(60000);

    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);
    await workViewPage.addTask('[Website](https://example.com/)');

    const task = taskPage.getTaskByText('Website');
    await expect(task).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const taskAfterReload = taskPage.getTaskByText('Website');
    await expect(taskAfterReload).toBeVisible();
  });

  test('task with markdown link should survive reload with urlBehavior extract', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(60000);

    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    // Set urlBehavior to 'extract' via IndexedDB state_cache
    await page.evaluate(async () => {
      const DB_NAME = 'SUP_OPS';
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
      });

      const tx = db.transaction('state_cache', 'readwrite');
      const store = tx.objectStore('state_cache');

      const entry = await new Promise<any>((resolve, reject) => {
        const request = store.get('current');
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
      });

      if (entry?.state?.globalConfig?.shortSyntax) {
        entry.state.globalConfig.shortSyntax.urlBehavior = 'extract';
        await new Promise<void>((resolve, reject) => {
          const putReq = store.put(entry, 'current');
          putReq.onsuccess = (): void => resolve();
          putReq.onerror = (): void => reject(putReq.error);
        });
      }

      db.close();
    });

    // Reload to pick up the config change
    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    // Add task — extract mode will remove the URL and mangle the title
    await workViewPage.addTask('[Website](https://example.com/)');

    const allTasks = await taskPage.getAllTasks().allTextContents();
    expect(allTasks.length).toBeGreaterThan(0);

    // Reload and verify the app still works
    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const tasksAfterReload = await taskPage.getAllTasks().allTextContents();
    expect(tasksAfterReload.length).toBeGreaterThan(0);
  });

  test('malformed title from extract mode should survive reload', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(60000);

    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    // Directly create a task with the mangled title that extract mode produces
    await workViewPage.addTask('Add [Website](');

    const task = taskPage.getTaskByText('[Website]');
    await expect(task).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const taskAfterReload = taskPage.getTaskByText('[Website]');
    await expect(taskAfterReload).toBeVisible();
  });
});
