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

test('saving a deadline without a reminder keeps it disabled', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.addTask('Synthetic silent deadline');
  const task = Object.values((await read(page)).tasks.entities).find((t) =>
    t?.title.includes('Synthetic silent deadline'),
  )!;
  await open(page, task.id);
  const dialog = page.locator('dialog-deadline');
  await dialog.locator('.mat-calendar-body-today').click();
  await dialog.locator('input[type="time"]').fill('15:00');
  await page.keyboard.press('Tab');
  await dialog.locator('mat-select').last().click();
  await page.locator('mat-option').filter({ hasText: /Never/ }).click();
  await dialog.getByRole('button', { name: 'Set deadline', exact: true }).click();
  expect((await read(page)).tasks.entities[task.id]?.deadlineRemindAt).toBeFalsy();
  await open(page, task.id);
  await dialog.locator('input[type="time"]').fill('16:00');
  await page.keyboard.press('Tab');
  await dialog.getByRole('button', { name: 'Set deadline', exact: true }).click();
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  expect((await read(page)).tasks.entities[task.id]?.deadlineRemindAt).toBeFalsy();
});
