import type { Page } from '@playwright/test';
import type { Store } from '@ngrx/store';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

const read = (page: Page): Promise<RootState> =>
  page.evaluate(() => {
    let state!: RootState;
    (
      window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return state;
  });
const dispatch = (page: Page, action: Record<string, unknown>): Promise<void> =>
  page.evaluate((a) => {
    (
      window as Window & { __e2eTestHelpers: { store: Store<RootState> } }
    ).__e2eTestHelpers.store.dispatch(a as { type: string });
  }, action);

test.beforeEach(async ({ page, workViewPage }) => {
  await page.clock.setSystemTime(new Date('2030-06-16T12:00:00'));
  await dispatch(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey: 'shortSyntax',
    sectionCfg: { isEnableDeadline: true },
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'shortSyntax',
      opType: 'UPD',
    },
  });
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
});

test('editing a title with date-only deadline syntax clears its prior time and reminder', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.addTask('Synthetic date deadline');
  const task = Object.values((await read(page)).tasks.entities).find((t) =>
    t?.title.includes('Synthetic date deadline'),
  )!;
  const withTime = new Date('2030-06-18T15:00:00').getTime();
  await dispatch(page, {
    type: '[Task Shared] setDeadline',
    taskId: task.id,
    deadlineWithTime: withTime,
    deadlineRemindAt: withTime - 900000,
    meta: { isPersistent: true, entityType: 'TASK', entityId: task.id, opType: 'UPD' },
  });
  const row = page.locator(`task[id="t-${task.id}"]`);
  await row.locator('task-title').click();
  await expect(row.locator('textarea')).toBeFocused();
  await page.waitForTimeout(100); // Let the component's deferred caret placement finish.
  await row.locator('textarea').fill('Synthetic date deadline !tomorrow');
  await row.locator('textarea').press('Tab');
  await expect
    .poll(async () => (await read(page)).tasks.entities[task.id]?.title)
    .toBe('Synthetic date deadline');
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  const saved = (await read(page)).tasks.entities[task.id]!;
  expect.soft(saved.deadlineDay).toBe('2030-06-17');
  expect.soft(saved.deadlineWithTime).toBeFalsy();
  expect.soft(saved.deadlineRemindAt).toBeFalsy();
});
