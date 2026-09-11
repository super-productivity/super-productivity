import { expect, test } from '../../fixtures/test.fixture';

/**
 * Live repro for https://github.com/super-productivity/super-productivity/issues/5162
 *
 * Deleting a calendar event task that was auto-imported (`isAutoImportForCurrentDay`)
 * must stick: the next auto-import pass (here: an app restart, which re-runs the
 * poll effect immediately) must NOT re-create the task.
 *
 * The iCal feed is stubbed via page.route so the test is hermetic.
 *
 * Discriminating end state after delete + reload:
 * - WITH the fix: the event is import-dismissed but still renders as a read-only
 *   calendar chip in the Schedule (dismissal only gates auto-import, not the view),
 *   and no task exists for it.
 * - WITHOUT the fix: the event is re-imported as a task, so the chip is filtered
 *   out (event id matches an existing task) and the task list contains it again —
 *   both assertions fail.
 */

const ICAL_URL = 'https://example.com/sp-5162.ics';
const EVENT_TITLE = 'E2E-5162 Sprint Planning';
// Control event TOMORROW that is never imported (auto-import is today-only). It
// always renders as a calendar chip, giving a positive "calendar finished
// rendering" anchor that is independent of the event under test.
const CONTROL_TITLE = 'E2E-5162 Control Tomorrow';

const PANEL_BTN = '.e2e-toggle-issue-provider-panel';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const icalDate = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const buildIcal = (): string => {
  const now = new Date();
  const today = icalDate(now);
  const tomorrow = icalDate(new Date(now.getTime() + ONE_DAY_MS));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SP E2E//EN',
    'BEGIN:VEVENT',
    `DTSTART:${today}T120000Z`,
    `DTEND:${today}T130000Z`,
    `SUMMARY:${EVENT_TITLE}`,
    'UID:e2e-5162-event',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `DTSTART:${tomorrow}T120000Z`,
    `DTEND:${tomorrow}T130000Z`,
    `SUMMARY:${CONTROL_TITLE}`,
    'UID:e2e-5162-control',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

test.describe('Calendar #5162', () => {
  test('deleted auto-imported calendar task is not re-imported after restart', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await page.route(ICAL_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/calendar',
        body: buildIcal(),
      }),
    );

    await workViewPage.waitForTaskList();

    // --- Configure a calendar provider with auto-import enabled ---
    await page.waitForSelector(PANEL_BTN, { state: 'visible' });
    await page.click(PANEL_BTN);
    await page.waitForSelector('mat-tab-group', { state: 'visible' });
    await page.click('mat-tab-group .mat-mdc-tab:last-child');
    await page.waitForSelector('issue-provider-setup-overview', { state: 'visible' });

    await page.getByRole('button', { name: 'Other (iCal)' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.locator('input[id*="icalUrl"]').fill(ICAL_URL);
    await dialog.getByRole('checkbox', { name: /auto import events as tasks/i }).check();

    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    await page.keyboard.press('Escape');

    // --- The event auto-imports as a task ---
    const importedTask = taskPage.getTaskByText(EVENT_TITLE);
    await expect(importedTask).toBeVisible({ timeout: 15000 });

    // --- Delete it (focus + Backspace avoids entering title edit mode) ---
    await importedTask.focus();
    await page.keyboard.press('Backspace');
    const confirmBtn = page.locator('mat-dialog-actions button:has-text("Delete")');
    const confirmAppeared = await confirmBtn
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (confirmAppeared) {
      await confirmBtn.click();
    }
    await expect(importedTask).not.toBeVisible({ timeout: 5000 });

    // --- Restart the app: the poll effect re-runs its import pass immediately ---
    // Importing an event also writes it to the per-day skip list, which filters the
    // Schedule *view* (not the import). Clear it so the chip assertion below can
    // discriminate: with the fix the event renders as a chip; without it, the
    // re-imported task filters the chip out.
    await page.evaluate(() => {
      localStorage.removeItem('SUP_CALENDER_EVENTS_SKIPPED_TODAY');
      localStorage.removeItem('SUP_CALENDER_EVENTS_LAST_SKIP_DAY');
    });
    await page.reload();
    await workViewPage.waitForTaskList();

    // --- The event renders as a calendar chip in the Schedule (NOT a task)… ---
    await page.goto(page.url().replace(/#.*$/, '') + '#/schedule');
    await page.waitForSelector('schedule', { state: 'visible', timeout: 10000 });
    const schedule = page.locator('schedule');
    await expect(schedule.getByText(CONTROL_TITLE).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(schedule.getByText(EVENT_TITLE).first()).toBeVisible({
      timeout: 10000,
    });

    // --- …and stays out of the task list ---
    // Use the canonical work-view route: bare `#/tag/TODAY` matches the lazy
    // `tag/:id` child routes, which have no empty-path route, and renders an
    // empty outlet on CI (locally the `**` fallback happens to rescue it).
    await page.goto(
      page.url().replace(/#.*$/, '').replace(/\/$/, '') + '#/tag/TODAY/tasks',
    );
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText(EVENT_TITLE)).toHaveCount(0);
  });
});
