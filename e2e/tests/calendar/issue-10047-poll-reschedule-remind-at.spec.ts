import { expect, test } from '../../fixtures/test.fixture';

/**
 * Repro for https://github.com/super-productivity/super-productivity/issues/10047
 *
 * When a poll-driven update changes a task's `dueWithTime`, `remindAt` is left
 * untouched: `issue.service.ts` applies poll results via a plain
 * `_taskService.update()`, which has no reminder branch in
 * `task-shared-scheduling.reducer.ts`. Only the import path (`addAndSchedule`)
 * derives `remindAt` from the reminder default.
 *
 * Repro: an all-day calendar event auto-imports as a task with no time, so
 * it's added via `add()` and never gets a `remindAt` (failure mode 1 in the
 * issue). The remote event (same UID) then gains a start time. The next poll
 * pass (`getFreshDataForIssueTasks` -> `_taskService.update()`) applies the
 * new `dueWithTime`, but `remindAt` stays unset.
 *
 * Expected: a task that is rescheduled to a specific time should get a
 * reminder, same as if it had been imported with that time from the start --
 * the task row should show the "alarm" icon (`t.remindAt` truthy) once it has
 * a `dueWithTime`.
 * Actual: only the plain "schedule"/"wb_sunny" icon shows; no reminder was
 * ever set, so the task will silently never notify.
 *
 * The iCal feed is stubbed via page.route so the test is hermetic. The poll
 * is triggered by switching work context (dispatches `setActiveWorkContext`,
 * which `poll-issue-updates.effects.ts` listens for) rather than reloading
 * the page, since a reload re-subscribes effects and misses the hydration
 * action that would otherwise kick off the same poll.
 */

const ICAL_URL = 'https://example.com/sp-10047.ics';
const EVENT_TITLE = 'E2E-10047 Standup';
const UID = 'e2e-10047-event';

const PANEL_BTN = '.e2e-toggle-issue-provider-panel';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const pad = (n: number): string => String(n).padStart(2, '0');

const icalDate = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

const icalDateTimeUtc = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

// Toggled by the test once the task has auto-imported, to simulate the event
// gaining a start time on the remote calendar.
let icsPhase: 'allDay' | 'timed' = 'allDay';

/**
 * The timed DTSTART, frozen on first use so every poll in one run sees the same
 * remote event and the reschedule is applied exactly once.
 *
 * It must be derived from `now` rather than written as a fixed UTC hour: the
 * suite rotates the wall-clock timezone (`e2e/utils/test-timezone.ts`) so local
 * time lands near midday, so a literal like `T180000Z` falls on the *next* local
 * day in the eastern candidates (the run that caught this was Pacific/Guadalcanal,
 * UTC+11). The task then leaves the Today list and the assertion below cannot
 * see it — a failure that has nothing to do with the reminder under test.
 * `now + 1h` stays on today's local date with ~10h of margin to midnight.
 */
let timedStart: Date | null = null;

const buildIcal = (): string => {
  const now = new Date();
  const today = icalDate(now);
  const tomorrow = icalDate(new Date(now.getTime() + ONE_DAY_MS));

  timedStart = timedStart ?? new Date(now.getTime() + ONE_HOUR_MS);

  const [dtstart, dtend] =
    icsPhase === 'allDay'
      ? [`DTSTART;VALUE=DATE:${today}`, `DTEND;VALUE=DATE:${tomorrow}`]
      : [
          `DTSTART:${icalDateTimeUtc(timedStart)}`,
          `DTEND:${icalDateTimeUtc(new Date(timedStart.getTime() + ONE_HOUR_MS))}`,
        ];

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SP E2E//EN',
    'BEGIN:VEVENT',
    dtstart,
    dtend,
    `SUMMARY:${EVENT_TITLE}`,
    `UID:${UID}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

test.describe('Calendar #10047', () => {
  test('poll-driven reschedule sets a reminder like import does', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    // Module-level feed state, so reset it for a retry of this same test.
    icsPhase = 'allDay';
    timedStart = null;

    await page.route(ICAL_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/calendar',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Cache-Control': 'no-store' },
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

    // --- The all-day event auto-imports with no time and (correctly) no
    // schedule/reminder affordance at all ---
    const task = taskPage.getTaskByText(EVENT_TITLE);
    await expect(task).toBeVisible({ timeout: 15000 });
    await expect(task.locator('.schedule-btn')).toHaveCount(0);

    // --- The remote event now carries a start time (same UID, i.e. a
    // poll-driven reschedule, not a new event) ---
    icsPhase = 'timed';

    // --- Switch work context: dispatches `setActiveWorkContext`, which
    // `poll-issue-updates.effects.ts` listens for to kick off its poll. (Note:
    // while on Inbox, the task's due-day badge shows regardless of the poll
    // outcome -- isShowDueDayBtn() only suppresses it on the active Today
    // list -- so that intermediate state proves nothing; only the check back
    // on Today, below, is meaningful.) ---
    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await page.getByRole('menuitem', { name: 'Today' }).click();

    // --- Expected: once the poll-driven reschedule lands, the task should
    // have a reminder, same as if it had been imported with a time from the
    // start -- the "alarm" icon should show ---
    await expect(task.locator('mat-icon:text("alarm")')).toBeVisible({
      timeout: 25000,
    });
  });
});
