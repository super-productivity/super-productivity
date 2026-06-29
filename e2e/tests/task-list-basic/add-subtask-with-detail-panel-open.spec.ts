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
 * With the panel open, pressing the add-subtask shortcut ('a') must open the
 * inline subtask draft input AND focus it — whether focus is inside the panel
 * (panel auto-focuses a detail item on open) or still on the main-list task row
 * (the common case the original fix missed). Typing a title and pressing Enter
 * then creates the subtask.
 */
test.describe('Add subtask with detail panel open', () => {
  const draftInput = (page: Page): Locator => page.locator('.e2e-add-subtask-input');

  const disableAnimations = async (page: Page): Promise<void> => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const store = (
            window as unknown as {
              __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
            }
          ).__e2eTestHelpers?.store;
          if (!store) return false;
          store.dispatch({
            type: '[Global Config] Update Global Config Section',
            sectionKey: 'misc',
            sectionCfg: { isDisableAnimations: true },
            isSkipSnack: true,
          });
          return true;
        }),
      )
      .toBe(true);
    await expect(page.locator('body.isDisableAnimations')).toBeVisible();
  };

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

  test('opens the inline subtask draft when focus is inside the panel', async ({
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

    const input = draftInput(page);
    await expect(input).toBeFocused();
    await input.fill('SubTask via shortcut');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task task-title').first()).toContainText(
      'SubTask via shortcut',
    );
  });

  test('opens the inline subtask draft when focus is on the main-list task', async ({
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

    const input = draftInput(page);
    await expect(input).toBeFocused();
    await input.fill('SubTask from main list');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task task-title').first()).toContainText(
      'SubTask from main list',
    );
  });

  test('adds multiple subtasks via repeated Enter while the draft stays open', async ({
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

    const input = draftInput(page);
    await expect(input).toBeFocused();

    // The draft stays open and refocused after each Enter, so a second subtask
    // is added by typing again — no need to re-trigger the 'a' shortcut.
    await input.fill('First');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');

    await input.fill('Second');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task')).toHaveCount(2);
  });

  // With animations disabled, Material fires the expansion panel's afterExpand
  // synchronously (inside the same change-detection pass), before the panel's
  // add-subtask-input viewChild is committed. The focus must still land — it is
  // deferred a tick precisely for this case. Regression guard for that fix.
  test('opens and focuses the inline draft when animations are disabled', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await disableAnimations(page);
    const parent = await addParentAndOpenPanel(page, workViewPage, taskPage);

    await expect
      .poll(async () =>
        page.evaluate(() => !!document.activeElement?.closest('task-detail-panel')),
      )
      .toBe(true);

    // Section starts collapsed, so this goes through the afterExpand focus path.
    await page.keyboard.press('a');

    const input = draftInput(page);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill('SubTask no anim');
    await page.keyboard.press('Enter');

    await expect(parent.locator('.sub-tasks task task-title').first()).toContainText(
      'SubTask no anim',
    );
  });
});
