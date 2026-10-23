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
const open = async (page: Page, id: string): Promise<void> => {
  await expect(page.locator('dialog-deadline')).toBeHidden();
  const row = page.locator(`task[id="t-${id}"]`);
  await row.focus();
  await row.press('Shift+s');
  await expect(page.locator('dialog-deadline')).toBeVisible();
};

test.beforeEach(async ({ page, workViewPage }) => {
  await page.clock.setSystemTime(new Date('2030-06-16T12:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
});

for (const quick of ['Today', 'Tomorrow']) {
  test(`deadline ${quick} respects a custom logical day`, async ({
    page,
    workViewPage,
  }) => {
    await dispatch(page, {
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'misc',
      sectionCfg: { startOfNextDay: 4, startOfNextDayTime: '04:00' },
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        opType: 'UPD',
      },
    });
    await flushPendingWrites(page);
    await page.clock.setSystemTime(new Date('2030-06-17T02:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Synthetic logical deadline');
    const task = Object.values((await read(page)).tasks.entities).find((t) =>
      t?.title.includes('Synthetic logical deadline'),
    )!;
    await open(page, task.id);
    await page
      .locator('dialog-deadline')
      .getByRole('button', { name: quick, exact: true })
      .click();
    await flushPendingWrites(page);
    expect((await read(page)).tasks.entities[task.id]?.deadlineDay).toBe(
      quick === 'Today' ? '2030-06-16' : '2030-06-17',
    );
  });
}
