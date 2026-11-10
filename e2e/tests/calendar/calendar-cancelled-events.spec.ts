import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { Task } from '../../../src/app/features/tasks/task.model';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

const URL = 'https://example.com/audit-calendar.ics';
const NOW = new Date('2026-10-24T08:00:00Z');
let icalBody = '';
test.use({ timezoneId: 'Europe/Berlin' });
const feed = async (...events: string[]): Promise<void> => {
  icalBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SP E2E//EN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
};

const event = (uid: string, title: string, ...fields: string[]): string =>
  ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, ...fields, 'END:VEVENT'].join(
    '\r\n',
  );

const addFeed = async (page: Page, autoImport = true): Promise<void> => {
  await page.route(URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/calendar', body: icalBody }),
  );
  await page.clock.setFixedTime(NOW);
  await page.reload();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('mat-tab-group .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'Other (iCal)' }).click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.locator('input[id*="icalUrl"]').fill(URL);
  if (autoImport)
    await dialog.getByRole('checkbox', { name: /auto import events as tasks/i }).check();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Escape');
};

const tasks = (page: Page): Promise<Partial<Task>[]> =>
  page.evaluate(() => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((s) => (state = s)).unsubscribe();
    return Object.values(state!.tasks.entities)
      .filter((t) => t?.issueType === 'ICAL')
      .map((t) => ({
        id: t!.id,
        issueId: t!.issueId,
        notes: t!.notes,
        title: t!.title,
        dueWithTime: t!.dueWithTime,
        dueDay: t!.dueDay,
        timeEstimate: t!.timeEstimate,
      }));
  });

test('cancelled standalone events do not auto-import as tasks', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await feed(
    event(
      'audit-cancelled',
      'Audit cancelled appointment',
      'DTSTART:20261024T120000Z',
      'DTEND:20261024T130000Z',
      'STATUS:CANCELLED',
    ),
    event(
      'audit-live',
      'Audit live appointment',
      'DTSTART:20261024T140000Z',
      'DTEND:20261024T150000Z',
    ),
  );
  await addFeed(page);
  await expect
    .poll(async () => (await tasks(page)).some((t) => t.issueId === 'audit-live'))
    .toBe(true);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  expect((await tasks(page)).map((t) => t.issueId)).toEqual(['audit-live']);
});
