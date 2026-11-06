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
  await page.reload();
  await workViewPage.waitForTaskList();
});

test('duplicating a family preserves its deadlines and deadline reminders', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.addTask('Synthetic deadline family');
  const parent = Object.values((await read(page)).tasks.entities).find((t) =>
    t?.title.includes('Synthetic deadline family'),
  )!;
  const row = page.locator(`task[id="t-${parent.id}"]`);
  await workViewPage.addSubTask(row, 'Synthetic deadline child');
  const childId = (await read(page)).tasks.entities[parent.id]!.subTaskIds[0];
  const withTime = new Date('2030-06-18T15:00:00').getTime();
  for (const [id, fields] of [
    [parent.id, { deadlineDay: '2030-06-17' }],
    [childId, { deadlineWithTime: withTime, deadlineRemindAt: withTime - 900000 }],
  ] as const) {
    await dispatch(page, {
      type: '[Task Shared] setDeadline',
      taskId: id,
      ...fields,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
  }
  await row.focus();
  await row.press('Control+d');
  await expect
    .poll(
      async () =>
        Object.values((await read(page)).tasks.entities).filter(
          (t) => t?.title === `${parent.title} (copy)`,
        ).length,
    )
    .toBe(1);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  const tasks = (await read(page)).tasks.entities;
  const copy = Object.values(tasks).find((t) => t?.title === `${parent.title} (copy)`)!;
  expect(copy.deadlineDay).toBe('2030-06-17');
  expect(copy.deadlineWithTime).toBeFalsy();
  expect(copy.subTaskIds).toHaveLength(1);
  const copiedChild = tasks[copy.subTaskIds[0]]!;
  expect(copiedChild.deadlineWithTime).toBe(withTime);
  expect(copiedChild.deadlineRemindAt).toBe(withTime - 900000);
  expect(copiedChild.deadlineDay).toBeFalsy();
  expect(tasks[parent.id]?.deadlineDay).toBe('2030-06-17');
  expect(tasks[childId]?.deadlineRemindAt).toBe(withTime - 900000);
});
