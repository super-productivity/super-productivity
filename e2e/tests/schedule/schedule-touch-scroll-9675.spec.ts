import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import { waitForStatePersistence } from '../../utils/waits';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
// The schedule grid is seeded at this size — a phone-width week column is ~50px
// wide — and the viewport shrinks to a phone before the schedule is touched.
const SETUP_VIEWPORT = { width: 1024, height: 900 };
const SCROLL_WRAPPER = 'schedule .scroll-wrapper';
// schedule-week draws two [data-day] cells per day (main + end-of-day).
const DAY_COL = 'schedule-week .col:not(.end-of-day)[data-day]';
// Mirrors DRAG_DELAY_FOR_TOUCH in src/app/app.constants.ts. E2E does not import from
// src, so if the source value ever rises above the hold below, the long-press test
// fails on its final assertion — the drag never starts.
const DRAG_DELAY_FOR_TOUCH = 500;
const DRAG_STEP_PX = 15;

type TouchDriver = {
  move: (x: number, y: number) => Promise<void>;
  start: (x: number, y: number) => Promise<void>;
  end: () => Promise<void>;
  detach: () => Promise<void>;
};

/**
 * Real touch input via CDP. Synthetic TouchEvents never produce native scrolling, so
 * they cannot tell "the page scrolled" apart from "nothing happened".
 */
const touchDriver = async (page: Page): Promise<TouchDriver> => {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, points: { x: number; y: number }[]): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points } as never);

  return {
    start: (x, y) => send('touchStart', [{ x, y }]) as Promise<void>,
    move: (x, y) => send('touchMove', [{ x, y }]) as Promise<void>,
    end: () => send('touchEnd', []) as Promise<void>,
    detach: () => cdp.detach(),
  };
};

/**
 * Put one event on the schedule, then open it as a phone would.
 *
 * The task is created by clicking the grid — the same way schedule-overlap and
 * schedule-split-segment seed theirs — and not by adding a task to Today. An
 * undated Today task only flows onto the grid while the current day still has
 * room for it, so a suite started in the evening found an empty schedule and
 * every test here failed on "element(s) not found". A task placed on tomorrow's
 * column renders at a fixed row whatever hour the run starts at, and sits far
 * enough ahead not to fire a reminder mid-test.
 *
 * The reload matters: input intent is per-session and the seeding above uses real
 * mouse clicks, which legitimately flips the app to mouse intent. A hash navigation
 * would keep that state, so the reload restores the touch-primary bootstrap a phone
 * actually gets — without it, `dragDelayForTouch()` is the mouse value of 0 and the
 * test proves nothing.
 */
const seedScheduledTaskAndOpenSchedule = async (
  page: Page,
  workViewPage: { waitForTaskList: () => Promise<void> },
  taskTitle: string,
): Promise<Locator> => {
  await workViewPage.waitForTaskList();
  await page.goto('/#/schedule');
  await expect(page.locator('schedule-week')).toBeVisible();

  const tomorrowCol = page.locator(DAY_COL).nth(1);
  await tomorrowCol.click({
    position: {
      x: await tomorrowCol.evaluate((el) => el.clientWidth / 2),
      // Midday, so the event keeps grid rows above and below it to be dragged to.
      y: await tomorrowCol.evaluate((el) => el.clientHeight / 2),
    },
  });
  const newTaskInput = page.getByRole('combobox', { name: 'Schedule task...' });
  await newTaskInput.fill(`${taskTitle} 3h`);
  await newTaskInput.press('Enter');

  // While a drag is live, CDK's clone is a second schedule-event with the same text.
  const event = page
    .locator('schedule-event:not(.custom-drag-preview)')
    .filter({ hasText: taskTitle });
  await expect(event).toBeVisible();
  // The reload below drops anything still queued: the new task has to be on disk
  // before it, or the schedule comes back empty.
  await waitForStatePersistence(page);

  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.reload();
  await expect(page.locator('schedule-week')).toBeVisible();
  await expect(event).toBeVisible();
  // The grid opens scrolled to the current hour, which is unrelated to where the
  // event sits — bring it into view before anything reads its box.
  await event.scrollIntoViewIfNeeded();
  return event;
};

test.describe('Schedule touch scrolling (#9675)', () => {
  // isMobile makes Chromium report `pointer: coarse`, which is what puts detect-it in
  // touchOnly mode and InputIntentService in 'touch' intent from bootstrap.
  test.use({
    viewport: SETUP_VIEWPORT,
    hasTouch: true,
    isMobile: true,
  });

  test('a deliberate swipe over a task scrolls instead of moving it', async ({
    page,
    workViewPage,
  }) => {
    const event = await seedScheduledTaskAndOpenSchedule(
      page,
      workViewPage,
      'Touch scroll task',
    );

    const scrollWrapper = page.locator(SCROLL_WRAPPER);

    // grid-area encodes both the start row and the span, so one comparison catches a
    // task that was moved to another time AND one whose duration was resized.
    const styleBefore = await event.getAttribute('style');
    const scroll = await scrollWrapper.evaluate((el) => ({
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
    }));
    // Without headroom below the current position the scroll assertion could pass
    // for the wrong reason — or never pass at all.
    expect(scroll.max - scroll.top).toBeGreaterThan(200);

    const box = await event.boundingBox();
    expect(box).not.toBeNull();
    const halfWidth = box!.width / 2;
    const halfHeight = box!.height / 2;
    const x = box!.x + halfWidth;
    const y = box!.y + halfHeight;

    const touch = await touchDriver(page);
    await touch.start(x, y);

    // Creep below CDK's 5px threshold for ~120ms. CDK only decides scroll-vs-drag at
    // the moment the threshold is crossed: if the drag start delay has elapsed by then
    // it drags, otherwise it abandons the sequence and the browser keeps the scroll.
    // This is what a slow, deliberate swipe looks like, and it is why the old 75ms
    // delay moved the task while the app-wide 500ms long press does not.
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(30);
      await touch.move(x, y - i);
    }

    // first move past the threshold — the decision point
    await page.waitForTimeout(15);
    await touch.move(x, y - 30);

    for (let i = 2; i <= 8; i++) {
      await page.waitForTimeout(15);
      const step = i * 20;
      const travelled = 30 + step;
      await touch.move(x, y - travelled);
    }
    await touch.end();
    await touch.detach();

    // With the drag delay too short, the swipe is consumed as a task move: the
    // schedule does not scroll and the task lands on a different grid row.
    await expect
      .poll(() => scrollWrapper.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(scroll.top);
    expect(await event.getAttribute('style')).toBe(styleBefore);
  });

  test('the resize handle is not rendered while touch is the active input', async ({
    page,
    workViewPage,
  }) => {
    const event = await seedScheduledTaskAndOpenSchedule(
      page,
      workViewPage,
      'Touch resize task',
    );

    // The handle is a 12px band on the bottom edge of every event — unhittable on
    // purpose with a finger, but easy to hit by accident, which is how a scroll swipe
    // became a duration change.
    await expect(event.locator('.resize-handle')).toHaveCount(0);
  });

  // The counterpart of the swipe test: raising the delay must not have traded an
  // unscrollable schedule for an unmovable task. This one passes on the pre-fix tree
  // too — it is a regression guard for the positive path, not a reproduction.
  test('a long press still moves a task to a new time', async ({
    page,
    workViewPage,
  }) => {
    const event = await seedScheduledTaskAndOpenSchedule(
      page,
      workViewPage,
      'Touch drag task',
    );

    // grid-area encodes the start row, so a changed style means the task landed on a
    // different time. Scrolling alone never changes it.
    const styleBefore = await event.getAttribute('style');

    const box = await event.boundingBox();
    expect(box).not.toBeNull();
    const halfWidth = box!.width / 2;
    const halfHeight = box!.height / 2;
    const x = box!.x + halfWidth;
    const y = box!.y + halfHeight;

    const touch = await touchDriver(page);
    await touch.start(x, y);

    // Hold still past DRAG_DELAY_FOR_TOUCH before crossing CDK's 5px threshold. CDK
    // decides scroll-vs-drag at the crossing, so with the delay already elapsed the
    // same movement that scrolls in the test above must drag here.
    await page.waitForTimeout(DRAG_DELAY_FOR_TOUCH + 200);

    for (let i = 1; i <= 8; i++) {
      const travelled = i * DRAG_STEP_PX;
      await touch.move(x, y + travelled);
      await page.waitForTimeout(15);
    }
    await touch.end();
    await touch.detach();

    await expect(event).not.toHaveClass(/cdk-drag-dragging/);
    await expect.poll(() => event.getAttribute('style')).not.toBe(styleBefore);
  });
});
