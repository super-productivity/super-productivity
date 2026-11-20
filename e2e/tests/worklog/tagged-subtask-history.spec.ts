import type { Store } from '@ngrx/store';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

test('an independently tagged untracked subtask does not erase tag history', async ({
  page,
  workViewPage,
  taskPage,
  tagPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const tagName = `${testPrefix}-HistoryTag`;
  await tagPage.createTag(tagName);
  const loggedTitle = `${testPrefix}-Logged`;
  await workViewPage.addTask(`${loggedTitle} 10m/1h`);
  await tagPage.assignTagToTask(taskPage.getTaskByText(loggedTitle), tagName);
  const parentTitle = `${testPrefix}-Parent`;
  await workViewPage.addTask(parentTitle);
  const parent = taskPage.getTaskByText(parentTitle);
  await workViewPage.addSubTask(parent, 'Untracked child');
  const child = taskPage.getSubTasks(parent).first();
  await tagPage.assignTagToTask(child, tagName);

  const tagId = await page.evaluate((title) => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((value) => (state = value)).unsubscribe();
    const tag = Object.values(state?.tag.entities ?? {}).find((t) => t?.title === title);
    if (!tag) throw new Error('Synthetic tag missing');
    return tag.id;
  }, tagName);
  await flushPendingWrites(page);
  await page.goto(`/#/tag/${tagId}/history`);
  await expect(page.locator('history')).toBeVisible();
  await expect(page.locator('history .total-time')).toContainText('10m');
  const dayToggle = page.locator('history .week-row .day-toggle').first();
  await expect(dayToggle).toBeVisible();
  await dayToggle.click();
  await expect(page.locator('.task-summary-table')).toContainText(loggedTitle);
  await expect(page.locator('.task-summary-table')).toContainText('Untracked child');

  await page.reload();
  await expect(page.locator('history .week-row .day-toggle').first()).toBeVisible();
});
