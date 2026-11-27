import type { Store } from '@ngrx/store';
import type { Locator, Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { startTaskDrag } from '../../utils/task-multi-drag';
import { flushPendingWrites } from '../../utils/waits';

const state = (page: Page): Promise<RootState> =>
  page.evaluate(() => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let result: RootState | undefined;
    store.subscribe((s) => (result = s)).unsubscribe();
    return result!;
  });
const disableAnimations = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (
      window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
    ).__e2eTestHelpers.store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'misc',
      sectionCfg: { isDisableAnimations: true },
      isSkipSnack: true,
    });
  });
const moveTo = async (page: Page, target: Locator): Promise<void> => {
  const box = await target.boundingBox();
  if (!box) throw new Error('No drop geometry');
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  await page.mouse.move(box.x + halfWidth, box.y + halfHeight, { steps: 25 });
};
for (const cancel of ['Escape', 'outside', 'normal']) {
  test(`single drag into family ${cancel}`, async ({ page, workViewPage, taskPage }) => {
    await workViewPage.waitForTaskList();
    await disableAnimations(page);
    await workViewPage.addTask('drag-parent');
    const parent = taskPage.getTaskByText('drag-parent');
    await workViewPage.addSubTask(parent, 'drag-child');
    await workViewPage.addTask('drag-mover');
    await page.keyboard.press('Escape');
    await flushPendingWrites(page);
    const before = await state(page);
    const moverId = Object.values(before.tasks.entities).find((t) =>
      t?.title.endsWith('drag-mover'),
    )!.id;
    const parentId = Object.values(before.tasks.entities).find((t) =>
      t?.title.endsWith('drag-parent'),
    )!.id;
    await startTaskDrag(
      page,
      taskPage.getTaskByText('drag-mover').locator('done-toggle').first(),
    );
    await moveTo(page, parent.locator('.sub-tasks task').first());
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    if (cancel === 'outside') await page.mouse.move(1000, 30, { steps: 20 });
    await page.mouse.up();
    await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    const after = await state(page);
    expect(after.tasks.entities[moverId]?.parentId ?? null).toBe(
      cancel === 'normal' ? parentId : null,
    );
    expect(after.tasks.entities[parentId]?.subTaskIds.length).toBe(
      cancel === 'normal' ? 2 : 1,
    );
  });
}
