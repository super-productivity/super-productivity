import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import { cssSelectors } from '../../constants/selectors';
import type { WorkViewPage } from '../../pages/work-view.page';
import type { TaskPage } from '../../pages/task.page';

const { DETAIL_PANEL } = cssSelectors;

/**
 * Repro for: "auto focus sub task on pressing 'a' shortcut is not working
 * when task detail panel is open".
 *
 * With the panel open, pressing the add-subtask shortcut ('a') must create a
 * sub-task AND focus its title input for editing — whether focus is inside the
 * panel (panel auto-focuses a detail item on open) or still on the main-list
 * task row (the common case the original fix missed).
 */
test.describe('Add subtask with detail panel open', () => {
  const focusedField = (page: Page): Locator =>
    page.locator('textarea:focus, input[type="text"]:focus');

  const addParentAndOpenPanel = async (
    page: Page,
    workViewPage: WorkViewPage,
    taskPage: TaskPage,
  ): Promise<Locator> => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent Task');
    const parent = taskPage.getTask(1);
    await expect(parent).toBeVisible();
    await taskPage.openTaskDetail(parent);
    await expect(page.locator(DETAIL_PANEL)).toBeVisible();
    return parent;
  };

  test('focuses the new subtask for edit when focus is inside the panel', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const parent = await addParentAndOpenPanel(page, workViewPage, taskPage);

    // Opening the panel moves focus into it (deferred auto-focus).
    await expect
      .poll(async () =>
        page.evaluate(() => !!document.activeElement?.closest('task-detail-panel')),
      )
      .toBe(true);

    await page.keyboard.press('a');

    const textarea = focusedField(page);
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill('SubTask via shortcut');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task task-title').first()).toContainText(
      'SubTask via shortcut',
    );
  });

  test('focuses the new subtask for edit when focus is on the main-list task', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const parent = await addParentAndOpenPanel(page, workViewPage, taskPage);

    // Let the panel's deferred open-time auto-focus land first, otherwise it can
    // fire *after* we move focus to the row below and silently steal it back.
    await expect
      .poll(async () =>
        page.evaluate(() => !!document.activeElement?.closest('task-detail-panel')),
      )
      .toBe(true);

    // Put focus back on the main-list task row (as if the user clicked or
    // arrow-navigated it with the panel open) — the path that goes through the
    // global shortcut handler and previously left the new subtask unfocused.
    // Re-apply focus on each retry: under load the row may not accept focus on
    // the first try, and .poll() alone would never re-focus it.
    await expect(async () => {
      await parent.focus();
      expect(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          return a?.tagName?.toLowerCase() === 'task' && !a.closest('task-detail-panel');
        }),
      ).toBe(true);
    }).toPass();

    await page.keyboard.press('a');

    const textarea = focusedField(page);
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill('SubTask from main list');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task task-title').first()).toContainText(
      'SubTask from main list',
    );
  });

  test('adds and focuses multiple subtasks via repeated "a"', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const parent = await addParentAndOpenPanel(page, workViewPage, taskPage);
    await expect
      .poll(async () =>
        page.evaluate(() => !!document.activeElement?.closest('task-detail-panel')),
      )
      .toBe(true);

    await page.keyboard.press('a');
    let textarea = focusedField(page);
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill('First');
    await page.keyboard.press('Enter');

    await page.keyboard.press('a');
    textarea = focusedField(page);
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill('Second');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task')).toHaveCount(2);
  });
});
