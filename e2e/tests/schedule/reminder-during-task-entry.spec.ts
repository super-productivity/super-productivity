import { expect, test } from '../../fixtures/test.fixture';
import { dispatch } from '../../utils/reorder-crossing';

test.use({ contextOptions: { hasTouch: true } });

test('keeps a schedule draft and its time when a reminder is dismissed', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Reminder task');
  const id = await page
    .locator('task', { hasText: 'Reminder task' })
    .getAttribute('data-task-id');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'View Day' }).click();
  const day = page.locator('schedule-week:not([inert] *)');
  const col = day.locator('.col:not(.end-of-day)').first();
  const today = await col.getAttribute('data-day');
  await page.getByRole('button', { name: 'Next Day' }).tap();
  await expect(col).not.toHaveAttribute('data-day', today!);
  const selectedDay = await col.getAttribute('data-day');
  await col.tap();
  const editor = day.locator('create-task-placeholder');
  const input = editor.getByRole('combobox');
  await input.fill('Draft');
  const startRow = await editor.evaluate((el) => getComputedStyle(el).gridRowStart);

  // Arm the real worker only once the user is typing.
  const due = Date.now();
  await dispatch(page, [
    {
      type: '[Task Shared] updateTask',
      task: { id, changes: { dueDay: null, dueWithTime: due, remindAt: due } },
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    },
  ]);
  const reminder = page.locator('dialog-view-task-reminder');
  await expect(reminder).toContainText('Reminder task', { timeout: 30_000 });
  await page
    .locator('.cdk-overlay-backdrop')
    .last()
    .tap({ position: { x: 4, y: 4 } });
  await expect(reminder).toBeHidden();
  await expect(input).toHaveValue('Draft');
  await input.press('End');
  await input.pressSequentially(' completed');
  await input.press('Enter');
  const saved = day.locator('schedule-event').filter({ hasText: 'Draft completed' });
  await expect(saved).toHaveCSS('grid-row-start', startRow);
  await expect(col).toHaveAttribute('data-day', selectedDay!);
});
