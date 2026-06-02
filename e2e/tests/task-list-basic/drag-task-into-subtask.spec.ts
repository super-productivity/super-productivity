import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

// End-to-end coverage for the "drag a task into a subtask list" feature
// (PR #7944 / #7905). The unit specs cover the reducer + the drop() payload in
// isolation; this exercises the real CDK drag → enterPredicate → convert flow.
test.describe('Drag task into subtask list', () => {
  const stableBoundingBox = async (
    locator: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> => {
    await locator.waitFor({ state: 'visible' });
    let box = await locator.boundingBox();
    // Wait until layout settles (non-null, non-zero height).
    await expect
      .poll(async () => {
        box = await locator.boundingBox();
        return !!box && box.height > 0;
      })
      .toBe(true);
    if (!box) throw new Error('drag source/target has no bounding box');
    return box;
  };

  /**
   * CDK drag-drop is event-driven; Playwright's `dragTo` uses HTML5 DnD which
   * CDK ignores. Drive the gesture manually so the CDK threshold + drag start
   * fire (same approach as work-view/sections.spec.ts).
   */
  const cdkDragTo = async (
    page: Page,
    source: Locator,
    target: Locator,
  ): Promise<void> => {
    const s = await stableBoundingBox(source);
    const t = await stableBoundingBox(target);
    /* eslint-disable no-mixed-operators */
    const sx = s.x + s.width / 2;
    const sy = s.y + s.height / 2;
    const tx = t.x + t.width / 2;
    const ty = t.y + t.height / 2;
    /* eslint-enable no-mixed-operators */
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Nudge past CDK's 5px drag threshold, then move smoothly so each
    // mousemove re-evaluates the drop target.
    await page.mouse.move(sx + 10, sy + 10, { steps: 5 });
    await page.mouse.move(tx, ty, { steps: 20 });
    await page.mouse.up();
  };

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

  test('converts a top-level task to a subtask when dropped onto a subtask list', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Parent with one existing subtask → its subtask drop list is rendered.
    await workViewPage.addTask('DragParent');
    const parent = page.locator('task').filter({ hasText: 'DragParent' }).first();
    await workViewPage.addSubTask(parent, 'ExistingSub');
    await parent.locator('.sub-tasks task').first().waitFor({ state: 'visible' });

    // A second top-level task to drag in.
    await workViewPage.addTask('DragMover');
    const mover = page.locator('task').filter({ hasText: 'DragMover' }).first();
    await expect(mover).toBeVisible();

    await disableAnimations(page);

    // Drop onto the centre of the existing subtask row — squarely inside the
    // subtask drop list, the robust core of the convert-to-subtask feature.
    const dragHandle = mover.locator('done-toggle').first();
    const subRow = parent
      .locator('.sub-tasks task')
      .filter({ hasText: 'ExistingSub' })
      .first();
    await cdkDragTo(page, dragHandle, subRow);

    // DragMover is now a subtask of DragParent.
    const subTasks = parent.locator('.sub-tasks task');
    await expect(subTasks.filter({ hasText: 'DragMover' })).toBeVisible({
      timeout: 5000,
    });
    await expect(subTasks).toHaveCount(2);
  });
});
