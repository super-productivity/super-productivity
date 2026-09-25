import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

// E2E reproduction for #9651: a task must keep its OWN tags when it is
// converted to a subtask (drag into a subtask list) and when it is converted
// back to a top-level task (context menu). Before the fix, nesting wiped the
// tags and promoting overwrote them with the previous parent's tags.
test.describe('Convert task keeps own tags (#9651)', () => {
  const stableBoundingBox = async (
    locator: Locator,
  ): Promise<{ x: number; y: number; width: number; height: number }> => {
    await locator.waitFor({ state: 'visible' });
    let box = await locator.boundingBox();
    await expect
      .poll(async () => {
        box = await locator.boundingBox();
        return !!box && box.height > 0;
      })
      .toBe(true);
    if (!box) throw new Error('drag source/target has no bounding box');
    return box;
  };

  // CDK drag-drop ignores Playwright's HTML5 dragTo — drive the gesture
  // manually (same approach as drag-task-into-subtask.spec.ts).
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

  const tagTitlesOf = (task: Locator): Locator => task.locator('tag-list tag .tag-title');

  test('keeps own tag when dragged into a subtask list and when converted back to parent task', async ({
    page,
    workViewPage,
    tagPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Pre-create tags so #shortSyntax attaches them without a confirm dialog.
    await tagPage.createTag('parTag');
    await tagPage.createTag('ownTag');

    // Parent with one existing subtask → its subtask drop list is rendered.
    await workViewPage.addTask('DragParent #parTag');
    const parent = page.locator('task').filter({ hasText: 'DragParent' }).first();
    await workViewPage.addSubTask(parent, 'ExistingSub');
    await parent.locator('.sub-tasks task').first().waitFor({ state: 'visible' });

    // The task under test, carrying its own tag.
    await workViewPage.addTask('DragMover #ownTag');
    const mover = page.locator('task').filter({ hasText: 'DragMover' }).first();
    await expect(tagTitlesOf(mover)).toContainText(['ownTag']);

    await disableAnimations(page);

    // --- Direction 1: top-level → subtask keeps the own tag ---
    const dragHandle = mover.locator('done-toggle').first();
    const subRow = parent
      .locator('.sub-tasks task')
      .filter({ hasText: 'ExistingSub' })
      .first();
    await cdkDragTo(page, dragHandle, subRow);

    const moverAsSub = parent.locator('.sub-tasks task').filter({ hasText: 'DragMover' });
    await expect(moverAsSub).toBeVisible({ timeout: 5000 });
    await expect(tagTitlesOf(moverAsSub)).toContainText(['ownTag']);

    // --- Direction 2: subtask → top-level keeps the own tag, not the parent's ---
    await moverAsSub.locator('task-title').click({ button: 'right' });
    const menu = page.locator('.mat-mdc-menu-panel');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /convert to parent task/i }).click();

    // Root-levelness is asserted via the sub-list toHaveCount(0) check below.
    const moverTopLevel = page.locator('task').filter({ hasText: 'DragMover' }).first();
    await expect(moverTopLevel).toBeVisible({ timeout: 5000 });
    // Not a subtask anymore
    await expect(
      parent.locator('.sub-tasks task').filter({ hasText: 'DragMover' }),
    ).toHaveCount(0);
    // Own tag kept, previous parent's tag NOT inherited
    await expect(tagTitlesOf(moverTopLevel)).toContainText(['ownTag']);
    await expect(tagTitlesOf(moverTopLevel).filter({ hasText: 'parTag' })).toHaveCount(0);
  });
});
