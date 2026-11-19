import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { touchPan } from '../../utils/touch-pan';
import { waitForStatePersistence } from '../../utils/waits';

const TITLE = 'Left over from yesterday';
// The swipe pager also renders the neighbouring days (inert) once touched.
const CURRENT_PAGE = '.page:not([inert])';
const OVERDUE = `${CURRENT_PAGE} schedule-day-overdue`;

type WorkView = {
  waitForTaskList: () => Promise<void>;
  addTask: (title: string) => Promise<void>;
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
    (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store.dispatch({
      type: '[Task Shared] updateTask',
      task: { id, changes: { dueDay, dueWithTime: undefined } },
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
  }, taskId);
};

const addOverdueTask = async (page: Page, workViewPage: WorkView): Promise<string> => {
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(TITLE);
  const taskId = (await page
    .locator('task')
    .filter({ hasText: TITLE })
    .first()
    .getAttribute('data-task-id'))!;
  await planForYesterday(page, taskId);
  return taskId;
};

const expandOverdue = async (dayPanel: Locator, isTouch = false): Promise<Locator> => {
  const overdue = dayPanel.locator(OVERDUE);
  const card = overdue.locator('planner-task').filter({ hasText: TITLE });
  // Collapsed at first: one line with the count, no cards.
  await expect(overdue.locator('.collapsible-header')).toContainText(
    'From previous days',
  );
  await expect(overdue.locator('.collapsible-count')).toHaveText('1');
  await expect(card).toHaveCount(0);
  await overdue.locator('.collapsible-header')[isTouch ? 'tap' : 'click']();
  await expect(card).toBeVisible();
  // Opening animates and shifts the scroll position with it, which would
  // cancel a long press that starts meanwhile.
  await expect(overdue.locator('.ng-animating')).toHaveCount(0);
  return card;
};

// On the card's title, clear of the done toggle and the estimate input.
const grabPoint = async (card: Locator): Promise<{ x: number; y: number }> => {
  const box = (await card.boundingBox())!;
  const halfHeight = box.height / 2;
  return { x: box.x + 60, y: box.y + halfHeight };
};

const expectPlacedToday = async (dayPanel: Locator): Promise<void> => {
  await expect(dayPanel.locator('schedule-event').filter({ hasText: TITLE })).toHaveCount(
    1,
  );
  // Placed today, so it is no longer overdue and the list is gone with it.
  await expect(dayPanel.locator('schedule-day-overdue')).toHaveCount(0);
};

const openDesktopPanel = async (
  page: Page,
  workViewPage: WorkView,
): Promise<{ dayPanel: Locator; taskId: string }> => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const taskId = await addOverdueTask(page, workViewPage);
  await page.locator('.e2e-toggle-schedule-day-panel').first().click();
  const dayPanel = page.locator('right-panel schedule-day-panel');
  await expect(dayPanel.locator('schedule-week')).toBeVisible();
  return { dayPanel, taskId };
};

// Picks the card up and moves it down onto the day's grid.
const dragOntoGrid = async (
  page: Page,
  dayPanel: Locator,
  card: Locator,
): Promise<{ x: number; y: number }> => {
  const start = await grabPoint(card);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, 500, { steps: 25 });
  await expect(dayPanel.locator('schedule-event.custom-drag-preview')).toBeInViewport();
  return start;
};

test.describe('Schedule day panel: overdue tasks', () => {
  test('lists an overdue task and places it by drag', async ({ page, workViewPage }) => {
    const { dayPanel, taskId } = await openDesktopPanel(page, workViewPage);
    // The panel opens at the current time, which the list must not cover.
    await expect(async () => {
      const overdueBox = (await dayPanel.locator(OVERDUE).boundingBox())!;
      const nowBox = (await dayPanel.locator('.current-time').boundingBox())!;
      expect(nowBox.y).toBeGreaterThanOrEqual(overdueBox.y + overdueBox.height);
    }).toPass();
    const card = await expandOverdue(dayPanel);
    // Stays open on other days, so the task can be placed on one of those too.
    const currentPage = dayPanel.locator(CURRENT_PAGE);
    await currentPage.getByRole('button', { name: 'Next Day', exact: true }).click();
    await expect(currentPage.locator('.current-time')).toHaveCount(0);
    await expect(card).toBeVisible();
    await currentPage.getByRole('button', { name: 'Previous Day', exact: true }).click();
    await expect(currentPage.locator('.current-time')).toBeVisible();
    await dragOntoGrid(page, dayPanel, card);
    await page.mouse.up();

    await expectPlacedToday(dayPanel);

    // One calm line again the next time something is overdue, not the open list.
    await planForYesterday(page, taskId);
    await expect(dayPanel.locator(`${OVERDUE} .collapsible-count`)).toHaveText('1');
    await expect(dayPanel.locator(`${OVERDUE} planner-task`)).toHaveCount(0);
  });

  test('leaves a task that is released over the list where it is', async ({
    page,
    workViewPage,
  }) => {
    const { dayPanel } = await openDesktopPanel(page, workViewPage);
    const card = await expandOverdue(dayPanel);
    const start = await dragOntoGrid(page, dayPanel, card);
    // Back to where it came from. The grid goes on underneath the list, so a
    // release here must not place the task at a time that is hidden.
    await page.mouse.move(start.x, start.y, { steps: 25 });
    await page.mouse.up();

    // Once the card has settled back, a placement would have shown by now.
    await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(
      dayPanel.locator('schedule-event').filter({ hasText: TITLE }),
    ).toHaveCount(0);
  });
});

test.describe('Schedule day panel on a touch phone: overdue tasks', () => {
  // isMobile makes Chromium report `pointer: coarse`, which starts the app in
  // touch intent: the long-press drag delay only applies then (see #9675).
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('places an overdue task by long-press drag in the bottom sheet', async ({
    page,
    workViewPage,
  }) => {
    await addOverdueTask(page, workViewPage);
    await waitForStatePersistence(page);
    // Back to touch intent, as on a real phone (the seeding used the mouse).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: 'Side Panel Menu' }).tap();
    await page.locator('.e2e-toggle-schedule-day-panel').tap();
    const dayPanel = page.locator('bottom-panel-container schedule-day-panel');
    await expect(dayPanel.locator('schedule-week')).toBeVisible();

    const card = await expandOverdue(dayPanel, true);
    // Straight down onto the day's grid. The sheet has scrolled to the current
    // time by now, which used to leave it without a drop zone.
    await touchPan(page, card, 0, {
      deltaY: 200,
      holdMs: 700,
      start: await grabPoint(card),
    });

    await expectPlacedToday(dayPanel);
  });
});
