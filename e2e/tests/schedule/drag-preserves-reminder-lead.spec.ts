import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { fillTimeInput } from '../../utils/time-input-helper';
import { flushPendingWrites } from '../../utils/waits';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

interface TaskSchedule {
  id: string;
  dueWithTime?: number;
  remindAt?: number;
}

const readSchedule = (page: Page, title: string): Promise<TaskSchedule> =>
  page.evaluate((taskTitle) => {
    type Root = {
      tasks: {
        entities: Record<
          string,
          { id: string; title: string; dueWithTime?: number; remindAt?: number }
        >;
      };
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (f: (root: Root) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let root!: Root;
    store.subscribe((value) => (root = value)).unsubscribe();
    const task = Object.values(root.tasks.entities).find((t) =>
      t.title.endsWith(taskTitle),
    )!;
    return { id: task.id, dueWithTime: task.dueWithTime, remindAt: task.remindAt };
  }, title);

const leadOf = (task: TaskSchedule): number => task.dueWithTime! - task.remindAt!;

const centerOf = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } => {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  return { x: box.x + halfWidth, y: box.y + halfHeight };
};

test.describe('Dragging a scheduled task keeps its reminder option', () => {
  test('in the schedule, to another day', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    const cols = page.locator('schedule-week .col:not(.end-of-day)[data-day]');
    const source = cols.nth(2);
    await source.click({
      position: {
        x: await source.evaluate((el) => el.clientWidth - 5),
        y: await source.evaluate((el) => el.clientHeight / 2),
      },
    });
    const input = page.getByRole('combobox', { name: 'Schedule task...' });
    await input.fill('Reminder lead task 1h');
    await input.press('Enter');
    const event = page
      .locator('schedule-event.ScheduledTask')
      .filter({ hasText: 'Reminder lead task' });
    await expect(event).toBeVisible();

    // Choose "30 minutes before" in the task's schedule dialog.
    await event.click();
    await page
      .locator('task-detail-item')
      .filter({
        has: page.locator('mat-icon', { hasText: /^(alarm|today|schedule|repeat)$/ }),
      })
      .first()
      .click();
    const dialog = page.locator('dialog-schedule-task');
    await expect(dialog).toBeVisible();
    await dialog.locator('mat-select[name="type"]').click();
    await page
      .getByRole('option', { name: '30 minutes before it starts', exact: true })
      .click();
    await dialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await expect(dialog).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('task-detail-panel')).toBeHidden();
    const before = await readSchedule(page, 'Reminder lead task');
    expect(leadOf(before)).toBe(THIRTY_MINUTES_MS);

    await event.scrollIntoViewIfNeeded();
    const eventBox = (await event.boundingBox())!;
    const start = {
      x: centerOf(eventBox).x,
      y: Math.min(eventBox.y + 15, centerOf(eventBox).y),
    };
    const targetX = centerOf((await cols.nth(3).boundingBox())!).x;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y, { steps: 3 });
    await page.mouse.move(targetX, start.y, { steps: 25 });
    await expect(page.locator('schedule-event.custom-drag-preview')).toBeVisible();
    await page.mouse.up();

    await expect
      .poll(async () => (await readSchedule(page, 'Reminder lead task')).dueWithTime)
      .not.toBe(before.dueWithTime);
    const moved = await readSchedule(page, 'Reminder lead task');
    expect(leadOf(moved)).toBe(THIRTY_MINUTES_MS);

    await flushPendingWrites(page);
    await page.reload();
    await expect(page.locator('schedule-week')).toBeVisible();
    expect(await readSchedule(page, 'Reminder lead task')).toEqual(moved);
  });

  test('from a list into the day panel', async ({ page, workViewPage, taskPage }) => {
    await page.clock.setSystemTime(new Date('2026-06-15T09:00:00'));
    await page.reload();
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Panel reminder 1h');
    const row = taskPage.getTaskByText('Panel reminder');

    // Schedule it for 14:00 with "30 minutes before".
    await row.focus();
    await page.keyboard.press('s');
    const dialog = page.locator('dialog-schedule-task');
    await expect(dialog).toBeVisible();
    await fillTimeInput(page, new Date('2026-06-15T14:00:00'));
    const reminder = dialog.locator('mat-select[name="type"]');
    await expect(reminder).toHaveCount(1);
    await reminder.click();
    await page
      .getByRole('option', { name: '30 minutes before it starts', exact: true })
      .click();
    await dialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await expect(dialog).toBeHidden();
    const before = await readSchedule(page, 'Panel reminder');
    expect(leadOf(before)).toBe(THIRTY_MINUTES_MS);

    await page.locator('.e2e-toggle-schedule-day-panel').first().click();
    await expect(page.locator('schedule-day-panel schedule-week')).toBeVisible();
    const sourceBox = (await row.boundingBox())!;
    const start = { x: sourceBox.x + 60, y: centerOf(sourceBox).y };
    const targetX = centerOf((await page.locator('right-panel .side').boundingBox())!).x;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y, { steps: 3 });
    await page.mouse.move(targetX, 400, { steps: 25 });
    await expect(
      page.locator('schedule-day-panel schedule-event.custom-drag-preview'),
    ).toBeVisible();
    await page.mouse.up();

    await expect
      .poll(async () => (await readSchedule(page, 'Panel reminder')).dueWithTime)
      .not.toBe(before.dueWithTime);
    const moved = await readSchedule(page, 'Panel reminder');
    expect(leadOf(moved)).toBe(THIRTY_MINUTES_MS);

    await flushPendingWrites(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    expect(await readSchedule(page, 'Panel reminder')).toEqual(moved);
  });
});
