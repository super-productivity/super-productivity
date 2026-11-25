import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import { startTaskDrag } from '../../utils/task-multi-drag';
import { flushPendingWrites } from '../../utils/waits';

/**
 * #11921: in a project grouped by tag, dropping a task into another tag group
 * gave it the group's tag but appended it at the group's end instead of keeping
 * the drop position.
 */

const groupByTag = async (page: Page): Promise<void> => {
  await page.locator('.task-filter-btn').click();
  const groupByItem = page.locator('.mat-mdc-menu-item', { hasText: 'Group By' });
  await expect(groupByItem).toBeVisible();
  await groupByItem.click();
  const tagOption = page.locator('.mat-mdc-menu-item', { hasText: 'Tag' }).last();
  await expect(tagOption).toBeVisible();
  await tagOption.click();
  await page.keyboard.press('Escape');
};

test.describe('Group by tag drop position (#11921)', () => {
  test('keeps the drop position when dropping into another tag group', async ({
    page,
    workViewPage,
    projectPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Grouped');
    await projectPage.navigateToProjectByName('Grouped');

    const tagName = `${testPrefix}-Tg`;
    await tagPage.createTag(tagName);

    const tagged = ['T1', 'T2', 'T3'].map((n) => `${testPrefix}-${n}`);
    const loose = `${testPrefix}-Loose`;
    for (const name of [...tagged, loose]) await workViewPage.addTask(name);

    const row = (name: string): Locator =>
      page
        .locator('task:not(.cdk-drag-preview)')
        .filter({ has: page.locator('task-title', { hasText: name }) })
        .first();
    for (const name of tagged) await tagPage.assignTagToTask(row(name), tagName);

    await groupByTag(page);

    const tagGroup = page
      .locator('work-view collapsible')
      .filter({ has: page.locator('.collapsible-title', { hasText: tagName }) });
    const groupTitles = tagGroup.locator('task .task-title');
    await expect(groupTitles).toHaveCount(3);
    const before = await groupTitles.allTextContents();

    // Drop onto the upper edge of the group's second row.
    await startTaskDrag(page, row(loose).locator('done-toggle'));
    // Resolved once: after the drag enters the group, CDK's placeholder is also
    // a `task` and would shift a re-evaluated nth(1).
    const targetRow = await tagGroup
      .locator('task:not(.cdk-drag-placeholder)')
      .nth(1)
      .elementHandle();
    const box = await targetRow?.boundingBox();
    if (!targetRow || !box) throw new Error('Missing drop row');
    const halfWidth = box.width / 2;
    const x = box.x + halfWidth;
    await page.mouse.move(x, box.y + 4, { steps: 25 });
    const entered = await targetRow.boundingBox();
    if (entered) await page.mouse.move(x, entered.y + 4, { steps: 5 });
    await page.mouse.up();

    const expected = [before[0], loose, before[1], before[2]];
    await expect(groupTitles).toHaveText(expected);

    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(groupTitles).toHaveText(expected);
  });
});
