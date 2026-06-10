import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

/**
 * E2E for issue #7412: subtask collapse/expand state should persist across
 * page reloads (it is stored via the synced setHideSubTasksMode action).
 *
 * Run with: npm run e2e:file e2e/tests/task-list-basic/subtask-collapse-persistence.spec.ts
 */

const dismissViteOverlay = async (page: Page): Promise<void> => {
  const overlay = page.locator('vite-error-overlay');
  const isVisible = await overlay.isVisible().catch(() => false);
  if (isVisible) {
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
};

test.describe('Subtask collapse persistence (#7412)', () => {
  test('collapsed subtasks stay collapsed after reload', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.addTask('Parent Task');
    const task = page.locator('task').first();
    await workViewPage.addSubTask(task, 'SubTask 1');

    const subTask = task.locator('.sub-tasks task');
    await subTask.waitFor({ state: 'visible' });

    // Collapse: with no done subtasks the toggle goes straight to HideAll,
    // which filters the subtask out of the sub task-list.
    await task.locator('.toggle-sub-tasks-btn').click();
    await expect(subTask).not.toBeVisible();
    // HideAll renders the "add" (expand) icon on the toggle button
    await expect(task.locator('.toggle-sub-tasks-btn mat-icon')).toContainText('add');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const taskAfterReload = page.locator('task').first();
    await expect(taskAfterReload.locator('task-title').first()).toContainText(
      'Parent Task',
    );
    // Still collapsed after reload
    await expect(taskAfterReload.locator('.sub-tasks task')).not.toBeVisible();
    await expect(taskAfterReload.locator('.toggle-sub-tasks-btn mat-icon')).toContainText(
      'add',
    );

    // And expanding again still works
    await taskAfterReload.locator('.toggle-sub-tasks-btn').click();
    await expect(taskAfterReload.locator('.sub-tasks task')).toBeVisible();
  });
});
