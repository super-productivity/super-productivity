import { expect, test } from '../../fixtures/test.fixture';
import { touchPan } from '../../utils/touch-pan';
import { waitForStatePersistence } from '../../utils/waits';

/** Format a Date as the app's day key (YYYY-MM-DD in local time). */
const dbDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// schedule-week draws two [data-day] cells per day (main + end-of-day) and
// schedule-month also uses [data-day], so scope day counting to the main
// week columns only. Day view's swipe pager keeps the neighbouring days
// rendered but inert, so those are left out too.
const DAY_COL = 'schedule-week:not([inert] *) .col:not(.end-of-day)[data-day]';

const PHONE_VIEWPORT = { width: 390, height: 844 };

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

test.describe('Schedule day view', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('renders one day, navigates a day at a time, and switches views', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('menuitem', { name: 'Schedule' }).click();

    const dayCols = page.locator(DAY_COL);
    const dayBtn = page.getByRole('button', { name: 'View Day' });
    const weekBtn = page.getByRole('button', { name: 'View Week' });
    const monthBtn = page.getByRole('button', { name: 'View Month' });
    const nextBtn = page.getByRole('button', { name: 'Next Day' });
    const prevBtn = page.getByRole('button', { name: 'Previous Day' });
    const todayBtn = page.locator('schedule .today-btn');
    // Scope to the header container: task events also render a `.title`, so a
    // bare `schedule .title` would be ambiguous once the schedule has events.
    const title = page.locator('schedule .schedule-nav-controls .title');
    const scheduleWeek = page.locator('schedule-week');
    const scheduleMonth = page.locator('schedule-month');

    const today = dbDate(new Date());
    // Calendar-based next day (DST-safe) so it matches the app's setDate(+1) logic.
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = dbDate(tomorrowDate);

    // --- Day view renders exactly one day (today), single-date header ---
    await dayBtn.click();
    await expect(dayCols).toHaveCount(1);
    await expect(dayCols.first()).toHaveAttribute('data-day', today);
    await expect(dayBtn).toHaveAttribute('aria-pressed', 'true');
    // Header is a single en-GB date ("Fri, 17 Jul 2026"; locale pinned in
    // config), not a week range.
    await expect(title).toHaveText(/^\w+, \d{1,2} \w+ \d{4}$/);
    // Viewing today: cannot go earlier, "today" reset is disabled.
    await expect(prevBtn).toBeDisabled();
    await expect(todayBtn).toBeDisabled();

    // --- Navigation moves exactly one day at a time ---
    await nextBtn.click();
    await expect(dayCols).toHaveCount(1);
    await expect(dayCols.first()).toHaveAttribute('data-day', tomorrow);
    // Off today, both "back to today" affordances become enabled.
    await expect(prevBtn).toBeEnabled();
    await expect(todayBtn).toBeEnabled();

    // Prev steps back to today (snap-to-today) and re-locks.
    await prevBtn.click();
    await expect(dayCols.first()).toHaveAttribute('data-day', today);
    await expect(prevBtn).toBeDisabled();

    // The Today button also resets to today after navigating away (distinct
    // code path from Prev: goToToday() vs goToPreviousPeriod()).
    await nextBtn.click();
    await expect(dayCols.first()).toHaveAttribute('data-day', tomorrow);
    await todayBtn.click();
    await expect(dayCols.first()).toHaveAttribute('data-day', today);
    await expect(todayBtn).toBeDisabled();

    // --- Switching views renders the expected grid each time ---
    await weekBtn.click(); // day -> week: week grid, more than one day
    await expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(scheduleWeek).toBeVisible();
    // week shows multiple day columns (retry-safe; not coupled to the exact count)
    await expect.poll(() => dayCols.count()).toBeGreaterThan(1);

    await monthBtn.click(); // week -> month: month grid replaces the week grid
    await expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(scheduleMonth).toBeVisible();
    await expect(scheduleWeek).toHaveCount(0);

    await dayBtn.click(); // month -> day: back to a single day column
    await expect(dayBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(scheduleMonth).toHaveCount(0);
    await expect(dayCols).toHaveCount(1);
  });

  test('pages a day at a time by swiping on a phone', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('menuitem', { name: 'Schedule' }).click();
    await page.getByRole('button', { name: 'View Day' }).click();
    await page.setViewportSize(PHONE_VIEWPORT);

    const dayCols = page.locator(DAY_COL);
    const scrollWrapper = page.locator('schedule .scroll-wrapper');
    const today = dbDate(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = dbDate(tomorrowDate);
    await expect(dayCols).toHaveCount(1);
    await expect(dayCols.first()).toHaveAttribute('data-day', today);

    // Mid-pan, tomorrow follows the finger in from the right.
    await touchPan(page, scrollWrapper, -220, {
      beforeRelease: async () => {
        await expect(
          page.locator(`swipe-pager .page:has(.col[data-day="${tomorrow}"])`),
        ).toBeInViewport();
      },
    });
    await expect(dayCols.first()).toHaveAttribute('data-day', tomorrow);
    await expect(page.getByRole('button', { name: 'Previous Day' })).toBeEnabled();

    await touchPan(page, scrollWrapper, 220);
    await expect(dayCols.first()).toHaveAttribute('data-day', today);

    // Never pages into the past.
    await touchPan(page, scrollWrapper, 220);
    await expect(dayCols.first()).toHaveAttribute('data-day', today);
    await expect(dayCols).toHaveCount(1);
  });
});

test.describe('Schedule day view on a touch phone', () => {
  // isMobile makes Chromium report `pointer: coarse`, which starts the app in
  // touch intent: the long-press drag delay only applies then (see #9675).
  test.use({
    viewport: { width: 1024, height: 900 },
    hasTouch: true,
    isMobile: true,
  });

  test('a long-press drag moves an event instead of paging the day', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Day' }).click();
    // Tomorrow: the event lands at a fixed row whatever hour the run starts.
    await page.getByRole('button', { name: 'Next Day' }).click();
    const dayCols = page.locator(DAY_COL);
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = dbDate(tomorrowDate);
    await expect(dayCols.first()).toHaveAttribute('data-day', tomorrow);

    const col = dayCols.first();
    await col.click({
      position: {
        x: await col.evaluate((el) => el.clientWidth / 2),
        y: await col.evaluate((el) => el.clientHeight / 2),
      },
    });
    const newTaskInput = page.getByRole('combobox', { name: 'Schedule task...' });
    await newTaskInput.fill('Long press task 2h');
    await newTaskInput.press('Enter');
    const event = page
      .locator('schedule-week:not([inert] *) schedule-event:not(.custom-drag-preview)')
      .filter({ hasText: 'Long press task' });
    await expect(event).toBeVisible();
    await waitForStatePersistence(page);

    // Back to touch intent, as on a real phone (the seeding used the mouse).
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.reload();
    await page.getByRole('button', { name: 'Next Day' }).tap();
    await expect(dayCols.first()).toHaveAttribute('data-day', tomorrow);
    await event.scrollIntoViewIfNeeded();
    const styleBefore = await event.getAttribute('style');
    const box = (await event.boundingBox())!;

    // Mostly sideways, so it would page if the pager claimed it; the bit of
    // vertical travel moves the event to another time. Two things keep the
    // pager out: it ignores moves after a long press, and once CDK starts the
    // drag it moves the element under <body>, out of the pager's reach.
    await touchPan(page, event, 160, {
      deltaY: 40,
      holdMs: 700,
      start: { x: box.x + 20, y: box.y + 15 },
    });

    await expect(dayCols.first()).toHaveAttribute('data-day', tomorrow);
    await expect(event).not.toHaveClass(/cdk-drag-dragging/);
    await expect.poll(() => event.getAttribute('style')).not.toBe(styleBefore);
  });
});
