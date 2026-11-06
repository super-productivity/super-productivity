import type { Page, Route } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * The CalDAV resource name is a dropdown of the server's task calendars.
 * When the list cannot load or comes back empty, the field is a text input,
 * so a calendar that the server does not list can still be entered.
 *
 * The CalDAV server is stubbed with page.route on the app's own origin.
 */

const DAV_ROOT = '/e2e-caldav-select/';
const PRINCIPAL_PATH = `${DAV_ROOT}principals/e2e/`;
const HOME_PATH = `${DAV_ROOT}calendars/e2e/`;

type StubMode = 'down' | 'empty' | 'listed';

const multistatus = (responses: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">' +
  responses +
  '</d:multistatus>';

const okResponse = (href: string, props: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>` +
  '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

const taskCalendar = (uri: string, name: string): string =>
  okResponse(
    `${HOME_PATH}${uri}/`,
    `<d:displayname>${name}</d:displayname>` +
      '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>' +
      '<cal:supported-calendar-component-set><cal:comp name="VTODO"/>' +
      '</cal:supported-calendar-component-set>',
  );

const stubCaldav = async (page: Page): Promise<{ mode: StubMode }> => {
  const stub: { mode: StubMode } = { mode: 'down' };
  await page.route(`**${DAV_ROOT}**`, async (route: Route) => {
    const req = route.request();
    const path = decodeURIComponent(new URL(req.url()).pathname);
    if (stub.mode === 'down') {
      return route.fulfill({ status: 503, body: '' });
    }
    const xml = (body: string): Promise<void> =>
      route.fulfill({
        status: 207,
        contentType: 'application/xml; charset=utf-8',
        headers: { DAV: '1, 2, 3, calendar-access' },
        body,
      });
    if (req.method() === 'PROPFIND' && path === DAV_ROOT) {
      return xml(
        multistatus(
          okResponse(
            DAV_ROOT,
            `<d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal>`,
          ),
        ),
      );
    }
    if (req.method() === 'PROPFIND' && path === PRINCIPAL_PATH) {
      return xml(
        multistatus(
          okResponse(
            PRINCIPAL_PATH,
            '<d:displayname>e2e</d:displayname>' +
              `<cal:calendar-home-set><d:href>${HOME_PATH}</d:href></cal:calendar-home-set>` +
              `<d:principal-collection-set><d:href>${DAV_ROOT}principals/</d:href></d:principal-collection-set>`,
          ),
        ),
      );
    }
    if (req.method() === 'PROPFIND' && path === HOME_PATH) {
      return xml(
        multistatus(
          okResponse(HOME_PATH, '<d:resourcetype><d:collection/></d:resourcetype>') +
            (stub.mode === 'listed'
              ? taskCalendar('inbox', 'Inbox') + taskCalendar('work', 'Work')
              : ''),
        ),
      );
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return stub;
};

test('CalDAV resource falls back to a text input when no calendars load', async ({
  page,
  workViewPage,
}) => {
  const stub = await stubCaldav(page);
  await workViewPage.waitForTaskList();

  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'CalDAV Todo', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog
    .locator('input[id*="caldavUrl"]')
    .fill(new URL(page.url()).origin + DAV_ROOT);
  await dialog.locator('input[id*="username"]').fill('e2e');
  await dialog.locator('input[id*="password"]').fill('e2e');

  const resourceSelect = dialog.locator('mat-select[id*="resourceName"]');
  const resourceInput = dialog.locator('input[id*="resourceName"]');

  // The server does not answer: type the name.
  await dialog.getByRole('button', { name: 'Load Options' }).click();
  await expect(resourceInput).toBeVisible();
  await expect(resourceSelect).toHaveCount(0);

  // The server lists calendars: choose one.
  stub.mode = 'listed';
  await dialog.getByRole('button', { name: /Load Options|Reload Options/ }).click();
  await expect(resourceSelect).toBeVisible();
  await expect(resourceInput).toHaveCount(0);
  await resourceSelect.click();
  await expect(page.getByRole('option', { name: 'Work', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // The server lists no task calendars: type the name again.
  stub.mode = 'empty';
  await dialog.getByRole('button', { name: /Load Options|Reload Options/ }).click();
  await expect(resourceInput).toBeVisible();
  await resourceInput.fill('hidden_calendar');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
});
