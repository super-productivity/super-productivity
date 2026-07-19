import { expect, test } from '../../fixtures/test.fixture';

/** Format a Date as the app's day key (YYYY-MM-DD in local time). */
const dbDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// schedule-week draws two [data-day] cells per day (main + end-of-day) and
// schedule-month also uses [data-day], so scope day counting to the main
// week columns only.
const DAY_COL = 'schedule-week .col:not(.end-of-day)[data-day]';

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
});
