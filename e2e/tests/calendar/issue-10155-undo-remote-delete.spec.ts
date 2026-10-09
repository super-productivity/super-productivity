import type { Locator, Page, Route } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression for https://github.com/super-productivity/super-productivity/issues/10155
 *
 * Deleting a task linked to a deletable calendar event offers UNDO in a snack.
 * The remote delete must wait out that window, so clicking UNDO keeps both the
 * task and the event. A CalDAV server is stubbed via page.route on the app's own
 * origin, and every DELETE it receives is recorded.
 *
 * A second event is deleted without UNDO after the first one was restored. Its
 * DELETE is the control: it proves the stub sees remote deletes at all, and since
 * the first delete's window started earlier, it would have fired by the time the
 * control's does.
 */

const PANEL_BTN = '.e2e-toggle-issue-provider-panel';
const DAV_ROOT = '/e2e-caldav/';
const CAL_HREF = `${DAV_ROOT}cal/`;
const UNDO_HREF = `${CAL_HREF}undo.ics`;
const CONTROL_HREF = `${CAL_HREF}control.ics`;
const UNDO_TITLE = 'E2E-10155 Undo Event';
const CONTROL_TITLE = 'E2E-10155 Control Event';

const icalUtc = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const ONE_HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

const buildEvent = (uid: string, title: string): string => {
  const start = new Date(Date.now() + ONE_HOUR_MS);
  const end = new Date(start.getTime() + HALF_HOUR_MS);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SP E2E//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icalUtc(new Date())}`,
    `DTSTART:${icalUtc(start)}`,
    `DTEND:${icalUtc(end)}`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

const davResponse = (href: string, props: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>` +
  '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

const multistatus = (responses: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  `${responses}</d:multistatus>`;

const stubCaldav = async (
  page: Page,
  events: Record<string, string>,
): Promise<string[]> => {
  const deleted: string[] = [];
  await page.route(`**${DAV_ROOT}**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const xml = (body: string): Promise<void> =>
      route.fulfill({ status: 207, contentType: 'application/xml', body });

    switch (req.method()) {
      case 'PROPFIND':
        return xml(
          multistatus(
            davResponse(DAV_ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') +
              davResponse(
                CAL_HREF,
                '<d:displayname>E2E Calendar</d:displayname>' +
                  '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>' +
                  '<c:supported-calendar-component-set><c:comp name="VEVENT"/>' +
                  '</c:supported-calendar-component-set>',
              ),
          ),
        );
      case 'REPORT':
        return xml(
          multistatus(
            Object.entries(events)
              .map(([href, ical]) =>
                davResponse(
                  href,
                  `<d:getetag>"1"</d:getetag><c:calendar-data>${ical}</c:calendar-data>`,
                ),
              )
              .join(''),
          ),
        );
      case 'GET':
        if (events[path]) {
          return route.fulfill({
            status: 200,
            contentType: 'text/calendar',
            headers: { ETag: '"1"' },
            body: events[path],
          });
        }
        break;
      case 'PUT':
        return route.fulfill({ status: 204, headers: { ETag: '"2"' }, body: '' });
      case 'DELETE':
        deleted.push(path);
        return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return deleted;
};

const setUpCaldavProvider = async (page: Page): Promise<void> => {
  await page.waitForSelector(PANEL_BTN, { state: 'visible' });
  await page.click(PANEL_BTN);
  await page.waitForSelector('mat-tab-group', { state: 'visible' });
  await page.click('mat-tab-group .mat-mdc-tab:last-child');
  await page.waitForSelector('issue-provider-setup-overview', { state: 'visible' });
  await page.getByRole('button', { name: 'CalDAV Events' }).click();

  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await dialog
    .locator('input[id*="serverUrl"]')
    .fill(new URL(page.url()).origin + DAV_ROOT);
  await dialog.locator('input[id*="username"]').fill('e2e');
  await dialog.locator('input[id*="password"]').fill('e2e');
  await dialog.getByRole('button', { name: /load options/i }).click();

  await dialog.locator('mat-select[id*="readCalendarIds"]').click();
  await page.getByRole('option', { name: 'E2E Calendar' }).click();
  await page.keyboard.press('Escape');
  await dialog.locator('mat-select[id*="writeCalendarId"]').click();
  await page.getByRole('option', { name: 'E2E Calendar' }).click();

  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
};

const importEvent = async (page: Page, title: string): Promise<void> => {
  const item = page.locator('issue-preview-item').filter({ hasText: title });
  await item.getByRole('button').first().click();
};

const deleteTask = async (page: Page, task: Locator): Promise<void> => {
  // Focus + Backspace avoids entering title edit mode.
  await task.focus();
  await page.keyboard.press('Backspace');
  await page.locator('mat-dialog-actions button:has-text("Delete")').click();
  await expect(task).not.toBeVisible({ timeout: 5000 });
};

test.describe('Calendar #10155', () => {
  test('undo after deleting a calendar event task keeps the remote event', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    const deleted = await stubCaldav(page, {
      [UNDO_HREF]: buildEvent('e2e-10155-undo', UNDO_TITLE),
      [CONTROL_HREF]: buildEvent('e2e-10155-control', CONTROL_TITLE),
    });

    await workViewPage.waitForTaskList();
    await setUpCaldavProvider(page);

    await page.click('mat-tab-group .mat-mdc-tab:first-child');
    await importEvent(page, UNDO_TITLE);
    await importEvent(page, CONTROL_TITLE);
    const undoTask = taskPage.getTaskByText(UNDO_TITLE);
    const controlTask = taskPage.getTaskByText(CONTROL_TITLE);
    await expect(undoTask).toBeVisible();
    await expect(controlTask).toBeVisible();

    // --- Delete, then UNDO from the snack ---
    await deleteTask(page, undoTask);
    await page.locator('snack-custom').getByRole('button', { name: /undo/i }).click();
    await expect(undoTask).toBeVisible();

    // --- Control: delete without UNDO, its remote delete must arrive ---
    await deleteTask(page, controlTask);
    await expect.poll(() => deleted, { timeout: 15000 }).toContain(CONTROL_HREF);

    expect(deleted).toEqual([CONTROL_HREF]);
    await expect(undoTask).toBeVisible();
  });
});
