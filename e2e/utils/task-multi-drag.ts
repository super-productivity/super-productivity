import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { waitForMenuSettled } from './waits';

const BAR = 'task-multi-select-bar .bar';
export const selectDragTasks = async (page: Page, names: string[]): Promise<void> => {
  const bar = page.locator(BAR);
  if (await bar.isVisible())
    await bar.getByRole('button', { name: 'Clear selection' }).click();
  for (const name of names)
    await page
      .locator('task')
      .filter({ has: page.locator('task-title', { hasText: name }) })
      .first()
      .locator('.task-title')
      .first()
      .click({ modifiers: ['Control'] });
  await expect(bar).toContainText(names.length + ' selected');
};
export const startTaskDrag = async (page: Page, source: Locator): Promise<void> => {
  await expect(source).toBeVisible();
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  if (!box) throw new Error('Missing drag source');
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  await page.mouse.move(box.x + halfWidth, box.y + halfHeight);
  await page.mouse.down();
  await page.mouse.move(box.x + halfWidth + 12, box.y + halfHeight + 12, { steps: 5 });
};
export const dropTaskDrag = async (
  page: Page,
  target: Locator,
  atStart = false,
): Promise<void> => {
  const inner = target.locator('.task-list-inner');
  const dropTarget = (await inner.count()) ? inner : target;
  const box = await dropTarget.boundingBox();
  if (!box) throw new Error('Missing drop target');
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  await page.mouse.move(box.x + halfWidth, box.y + (atStart ? 3 : halfHeight), {
    steps: 25,
  });
  // Entering an empty list inserts a placeholder and can shift its geometry.
  const enteredBox = await dropTarget.boundingBox();
  const enteredHalfWidth = enteredBox ? enteredBox.width / 2 : 0;
  if (enteredBox)
    await page.mouse.move(
      enteredBox.x + enteredHalfWidth,
      enteredBox.y + (atStart ? 3 : enteredBox.height / 2),
      { steps: 5 },
    );
  await page.mouse.up();
};
export const createDragSection = async (page: Page, name: string): Promise<void> => {
  await page.locator('.project-settings-btn').click();
  await waitForMenuSettled(page);
  await page.getByRole('menuitem', { name: 'Add Section' }).click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.locator('input[type="text"]').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
};
