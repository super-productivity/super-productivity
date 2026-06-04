import { expect, test } from '../../fixtures/test.fixture';

/**
 * Live repro for https://github.com/super-productivity/super-productivity/issues/7971
 *
 * A calendar event auto-imported as a task, completed and archived via "Finish Day",
 * must NOT re-surface in the Schedule the next time calendar events are rendered.
 *
 * The iCal feed is stubbed via page.route so the test is hermetic. We rely on
 * `isAutoImportForCurrentDay` to turn the event into a task without driving the
 * (fragile) schedule context-menu.
 *
 * With the bug present, the archived calendar task drops out of
 * `selectAllCalendarTaskEventIds` and the event reappears in the Schedule as a
 * "not yet added" entry → this test's final assertion fails. With the fix, the
 * Schedule filter also consults the archive, so the event stays hidden.
 */

const ICAL_URL = 'https://example.com/sp-7971.ics';
const EVENT_TITLE = 'E2E-7971 Dentist Appointment';
// A control event TOMORROW that is never imported/archived. It always renders as a
// calendar chip, so we can wait for it (a positive signal that the calendar finished
// rendering) before asserting the archived event is absent — no flaky fixed timeouts.
const CONTROL_TITLE = 'E2E-7971 Control Tomorrow';

const PANEL_BTN = '.e2e-toggle-issue-provider-panel';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const icalDate = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;

// iCal feed with (1) a TODAY event that auto-import turns into a task, and (2) a
// TOMORROW control event that is never imported (auto-import is today-only).
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
    'UID:e2e-7971-event',
    'END:VEVENT',
    'BEGIN:VEVENT',
    `DTSTART:${tomorrow}T120000Z`,
    `DTEND:${tomorrow}T130000Z`,
    `SUMMARY:${CONTROL_TITLE}`,
    'UID:e2e-7971-control',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

test.describe('Calendar #7971', () => {
  test('archived calendar task does not regenerate in the schedule', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    // Stub the iCal feed for every request to the provider URL.
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

    // Open the generic iCal setup dialog ("Other (iCal)" → plain icalUrl, no OAuth).
    await page.getByRole('button', { name: 'Other (iCal)' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // formly renders inputs with id="formly_<n>_input_<key>_<n>", not formcontrolname.
    await dialog.locator('input[id*="icalUrl"]').fill(ICAL_URL);
    // "Auto import events as tasks for current day" is a checkbox.
    await dialog.getByRole('checkbox', { name: /auto import events as tasks/i }).check();

    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Close the issue-provider panel so it doesn't overlay the task list.
    await page.keyboard.press('Escape');

    // --- The event should auto-import as a task ---
    const importedTask = taskPage.getTaskByText(EVENT_TITLE);
    await expect(importedTask).toBeVisible({ timeout: 15000 });

    // --- Complete it and finish the day to archive it ---
    await taskPage.markTaskAsDone(importedTask);

    await page.locator('.e2e-finish-day').click();
    await page.waitForSelector('daily-summary', { state: 'visible', timeout: 10000 });
    await page.locator(SAVE_AND_GO_HOME_BTN).click();
    await page.waitForURL(/(active\/tasks|tag\/TODAY(?!\/daily-summary))/, {
      timeout: 10000,
    });

    // Simulate "the next day": importing an event skips it for the rest of the current
    // day (addTaskFromIssue → skipCalendarEvent), which is why the bug only appears the
    // NEXT day. Clear the per-day skip and reload so the event is eligible to show again.
    await page.evaluate(() => {
      localStorage.removeItem('SUP_CALENDER_EVENTS_SKIPPED_TODAY');
      localStorage.removeItem('SUP_CALENDER_EVENTS_LAST_SKIP_DAY');
    });
    await page.reload();
    await workViewPage.waitForTaskList();

    // The archived calendar event must NOT reappear in the Schedule…
    await page.goto(page.url().replace(/#.*$/, '') + '#/schedule');
    await page.waitForSelector('schedule', { state: 'visible', timeout: 10000 });
    // Anchor: the un-archived control event must render → calendar has finished loading.
    await expect(page.getByText(CONTROL_TITLE).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(EVENT_TITLE)).toHaveCount(0);

    // …nor in the Planner. (Without the fix it re-surfaces as an un-added calendar entry.)
    await page.goto(page.url().replace(/#.*$/, '') + '#/planner');
    await expect(page.getByText(CONTROL_TITLE).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(EVENT_TITLE)).toHaveCount(0);
  });
});
