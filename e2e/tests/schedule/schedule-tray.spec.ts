import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

const TITLE = 'Plan without a time';
const OVERDUE_TITLE = 'Left over from yesterday';

type E2eWindow = {
  __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
};

const enableTrayMode = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    (window as unknown as E2eWindow).__e2eTestHelpers.store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'schedule',
      sectionCfg: { untimedTaskPlacement: 'tray' },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'schedule',
        opType: 'UPD',
      },
    });
  });
};

// Planned for yesterday and without a time, which makes a task overdue today.
const planForYesterday = async (page: Page, taskId: string): Promise<void> => {
  await page.evaluate((id) => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const dueDay = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    (window as unknown as E2eWindow).__e2eTestHelpers.store.dispatch({
      type: '[Task Shared] updateTask',
      task: { id, changes: { dueDay } },
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
  }, taskId);
};

// Starts the drag with a small move first, as the drag threshold needs one.
const drag = async (
  page: Page,
  source: Locator,
  to: { x: number; y: number },
): Promise<void> => {
  const box = (await source.boundingBox())!;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const from = { x: box.x + halfWidth, y: box.y + Math.min(10, halfHeight) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 15 });
};

const centerOf = async (target: Locator): Promise<{ x: number; y: number }> => {
  const box = (await target.boundingBox())!;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  return { x: box.x + halfWidth, y: box.y + halfHeight };
};

test.describe('Schedule tray mode', () => {
  test('keeps a task without a time in the tray until it is dragged to a time', async ({
    page,
    workViewPage,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(TITLE);
    await enableTrayMode(page);
    await page.getByRole('menuitem', { name: 'Schedule' }).click();

    const week = page.locator('schedule schedule-week');
    const event = week.locator('schedule-event').filter({ hasText: TITLE });
    const cells = week.locator('schedule-tray .tray-cell');
    const chip = cells.first().locator('.chip').filter({ hasText: TITLE });

    // Planned for today, but not given a time by the app.
    await expect(chip).toBeVisible();
    await expect(event).toHaveCount(0);
    const today = (await cells.first().getAttribute('data-tray-day'))!;
    const tomorrow = (await cells.nth(1).getAttribute('data-tray-day'))!;

    // Onto tomorrow's column: now it has a day and a time.
    const column = week.locator(`.col[data-day="${tomorrow}"]:not(.end-of-day)`);
    const columnCenter = await centerOf(column);
    await drag(page, chip, { x: columnCenter.x, y: 500 });
    await expect(week.locator('.custom-drag-preview')).toBeVisible();
    await page.mouse.up();

    await expect(event).toHaveCount(1);
    const columnBox = (await column.boundingBox())!;
    const eventCenter = await centerOf(event);
    expect(eventCenter.x).toBeGreaterThan(columnBox.x);
    expect(eventCenter.x).toBeLessThan(columnBox.x + columnBox.width);
    // Nothing is left without a time, so the row is gone as well.
    await expect(week.locator('schedule-tray .tray-cell')).toHaveCount(0);

    // Back onto today's day header: planned for the day, without a time.
    const dayHeader = week.locator(`.week-header .day[data-tray-day="${today}"]`);
    await drag(page, event, await centerOf(dayHeader));
    await expect(dayHeader).toHaveClass(/drag-over/);
    await page.mouse.up();

    await expect(
      week
        .locator(`schedule-tray .tray-cell[data-tray-day="${today}"] .chip`)
        .filter({ hasText: TITLE }),
    ).toBeVisible();
    await expect(event).toHaveCount(0);
  });

  test('keeps the current time below the tray and the overdue list in the day panel', async ({
    page,
    workViewPage,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(TITLE);
    await workViewPage.addTask(OVERDUE_TITLE);
    const overdueId = (await page
      .locator('task')
      .filter({ hasText: OVERDUE_TITLE })
      .first()
      .getAttribute('data-task-id'))!;
    await planForYesterday(page, overdueId);
    await enableTrayMode(page);
    await page.locator('.e2e-toggle-schedule-day-panel').first().click();

    // The swipe pager also renders the neighbouring days (inert) once touched.
    const dayPage = page.locator('right-panel schedule-day-panel .page:not([inert])');
    const tray = dayPage.locator('schedule-tray');
    const overdue = dayPage.locator('schedule-day-overdue');
    await expect(tray.locator('.chip').filter({ hasText: TITLE })).toBeVisible();
    await expect(tray.locator('.chip').filter({ hasText: OVERDUE_TITLE })).toHaveCount(0);
    await expect(overdue.locator('.collapsible-count')).toHaveText('1');

    // Both stick to the top of the panel, one below the other, and the panel
    // opens at the current time, which neither may cover.
    await expect(async () => {
      const trayBox = (await tray.boundingBox())!;
      const overdueBox = (await overdue.boundingBox())!;
      const nowBox = (await dayPage.locator('.current-time').boundingBox())!;
      expect(Math.round(overdueBox.y)).toBeGreaterThanOrEqual(
        Math.round(trayBox.y + trayBox.height),
      );
      expect(nowBox.y).toBeGreaterThanOrEqual(overdueBox.y + overdueBox.height);
    }).toPass();

    // On its way to the grid a chip crosses the overdue list. The grid goes on
    // underneath, so a release there must not give it a time that is hidden.
    const chip = tray.locator('.chip').filter({ hasText: TITLE });
    await drag(page, chip, await centerOf(overdue));
    await page.mouse.up();
    await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
    await expect(chip).toBeVisible();
    await expect(
      dayPage.locator('schedule-event').filter({ hasText: TITLE }),
    ).toHaveCount(0);
  });
});
