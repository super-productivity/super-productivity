import type { Page, Route } from '@playwright/test';
import type { IssueProviderCaldav } from '../../../src/app/features/issue/issue.model';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * CalDAV task provider, opt-in server writes (#10098, #10096):
 * - a task added in the bound project is uploaded as one VTODO, named after
 *   its UID, without overwriting an existing one, with the category filter's
 *   category; a later import poll does not add it a second time (the poll
 *   racing the in-flight create is covered by the CaldavCommonInterfaces
 *   unit specs; a page.route stub can't hold that window open reliably);
 * - deleting that task deletes the VTODO once the undo window has passed;
 * - with the settings off (the default), neither write happens.
 *
 * The CalDAV server is stubbed with page.route on the app's own origin.
 */

const DAV_ROOT = '/e2e-caldav-vtodo/';
const PRINCIPAL_PATH = `${DAV_ROOT}principals/e2e/`;
const HOME_PATH = `${DAV_ROOT}calendars/e2e/`;
const CALENDAR_PATH = `${HOME_PATH}tasks/`;
const CALENDAR_NAME = 'E2E Tasks';
const CATEGORY = 'sp-e2e';
const UNDO_WINDOW_PLUS_MARGIN_MS = 5000 + 1000 + 2000;

interface StoredTodo {
  path: string;
  body: string;
  etag: string;
}

interface CaldavStub {
  todos: StoredTodo[];
  puts: { path: string; ifNoneMatch?: string; body: string }[];
  deletes: { path: string; ifMatch?: string }[];
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const multistatus = (responses: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">' +
  responses +
  '</d:multistatus>';

const okResponse = (href: string, props: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>` +
  '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

const todoResponse = (todo: StoredTodo): string =>
  okResponse(
    todo.path,
    '<d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>' +
      `<d:getetag>${escapeXml(todo.etag)}</d:getetag>` +
      `<cal:calendar-data>${escapeXml(todo.body)}</cal:calendar-data>`,
  );

/**
 * Enough CalDAV for `@nextcloud/cdav-library`: principal discovery, the
 * calendar home, VTODO REPORTs (narrowed by a UID text-match), PUT with
 * If-None-Match, PROPFIND of a single object, and DELETE.
 */
const stubCaldav = async (page: Page): Promise<CaldavStub> => {
  const stub: CaldavStub = { todos: [], puts: [], deletes: [] };
  await page.route(`**${DAV_ROOT}**`, async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const path = decodeURIComponent(new URL(req.url()).pathname);
    const depth = req.headers()['depth'];
    const xml = (body: string): Promise<void> =>
      route.fulfill({
        status: 207,
        contentType: 'application/xml; charset=utf-8',
        headers: { DAV: '1, 2, 3, calendar-access' },
        body,
      });
    const todo = stub.todos.find((t) => t.path === path);

    if (method === 'PUT') {
      const body = req.postData() ?? '';
      const ifNoneMatch = req.headers()['if-none-match'];
      stub.puts.push({ path, ifNoneMatch, body });
      if (todo && ifNoneMatch === '*') {
        return route.fulfill({ status: 412, body: '' });
      }
      const etag = `"e2e-${stub.puts.length}"`;
      if (todo) {
        todo.body = body;
        todo.etag = etag;
      } else {
        stub.todos.push({ path, body, etag });
      }
      return route.fulfill({ status: 201, headers: { ETag: etag }, body: '' });
    }
    if (method === 'DELETE') {
      stub.deletes.push({ path, ifMatch: req.headers()['if-match'] });
      stub.todos = stub.todos.filter((t) => t.path !== path);
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'REPORT' && path === CALENDAR_PATH) {
      const query = req.postData() ?? '';
      const uidMatch = /<[^>]*text-match[^>]*>([^<]+)</.exec(query)?.[1];
      const todos = uidMatch
        ? stub.todos.filter((t) => t.body.includes(`UID:${uidMatch}`))
        : stub.todos;
      return xml(multistatus(todos.map(todoResponse).join('')));
    }
    if (method === 'PROPFIND') {
      if (todo) {
        return xml(multistatus(todoResponse(todo)));
      }
      if (path === DAV_ROOT) {
        return xml(
          multistatus(
            okResponse(
              DAV_ROOT,
              `<d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal>`,
            ),
          ),
        );
      }
      if (path === PRINCIPAL_PATH) {
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
      if (path === HOME_PATH && depth === '1') {
        return xml(
          multistatus(
            okResponse(HOME_PATH, '<d:resourcetype><d:collection/></d:resourcetype>') +
              okResponse(
                CALENDAR_PATH,
                `<d:displayname>${CALENDAR_NAME}</d:displayname>` +
                  '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>' +
                  '<cal:supported-calendar-component-set><cal:comp name="VTODO"/>' +
                  '</cal:supported-calendar-component-set>',
              ),
          ),
        );
      }
    }
    console.log(`[CaldavStub] Unhandled ${method} ${path} depth=${depth}`);
    return route.fulfill({ status: 404, body: '' });
  });
  return stub;
};

const foreignTodo = (uid: string, summary: string): StoredTodo => ({
  path: `${CALENDAR_PATH}${uid}.ics`,
  etag: `"${uid}"`,
  body: [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//E2E//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `SUMMARY:${summary}`,
    `CATEGORIES:${CATEGORY}`,
    'STATUS:NEEDS-ACTION',
    'END:VTODO',
    'END:VCALENDAR',
    '',
  ].join('\r\n'),
});

const dispatch = (page: Page, action: Record<string, unknown>): Promise<void> =>
  page.evaluate((a) => {
    (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (x: unknown) => void } };
      }
    ).__e2eTestHelpers.store.dispatch(a);
  }, action);

interface StateTask {
  id: string;
  title: string;
  issueId?: string;
  issueType?: string;
}

const tasksTitled = (page: Page, title: string): Promise<StateTask[]> =>
  page.evaluate((t) => {
    let tasks: StateTask[] = [];
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              fn: (s: { tasks: { entities: Record<string, StateTask> } }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => {
        tasks = Object.values(s.tasks.entities).filter((task) => task.title === t);
      })
      .unsubscribe();
    return tasks;
  }, title);

const currentProjectId = async (page: Page): Promise<string> => {
  await expect(page).toHaveURL(/\/project\/[^/]+\/tasks/);
  return /\/project\/([^/]+)\/tasks/.exec(page.url())![1];
};

const addProvider = async (
  page: Page,
  projectId: string,
  twoWaySync: IssueProviderCaldav['twoWaySync'],
): Promise<void> => {
  const id = `caldav-e2e-${Date.now()}`;
  const provider: IssueProviderCaldav = {
    id,
    issueProviderKey: 'CALDAV',
    isEnabled: true,
    isAutoPoll: true,
    isAutoAddToBacklog: true,
    isIntegratedAddTaskBar: false,
    defaultProjectId: projectId,
    pinnedSearch: null,
    caldavUrl: new URL(page.url()).origin + DAV_ROOT,
    resourceName: CALENDAR_NAME,
    username: 'synthetic-user',
    password: 'synthetic-only-not-a-credential',
    categoryFilter: CATEGORY,
    twoWaySync,
  };
  await dispatch(page, {
    type: '[IssueProvider/API] Add IssueProvider',
    issueProvider: provider,
    meta: {
      isPersistent: true,
      entityType: 'ISSUE_PROVIDER',
      entityId: id,
      opType: 'CRT',
    },
  });
};

const deleteTaskViaUi = async (page: Page, title: string): Promise<void> => {
  const task = page.locator('task').filter({ hasText: title }).first();
  const confirm = page.locator('mat-dialog-actions button:has-text("Delete")');
  // Delete confirmation is on at the defaults, so Backspace always opens the
  // dialog. A key press that lands while the row has lost focus opens nothing,
  // so press again only while neither the dialog nor the deletion happened.
  await expect(async () => {
    if (!(await confirm.isVisible())) {
      // Focus + Backspace avoids entering title edit mode.
      await task.focus();
      await page.keyboard.press('Backspace');
    }
    await expect(confirm).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 15000 });
  await confirm.click();
  await expect(task).not.toBeVisible({ timeout: 5000 });
};

test.describe('CalDAV VTODO create/delete on server (#10098, #10096)', () => {
  test('uploads a new task once, keeps it single, and deletes it after the undo window', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    const stub = await stubCaldav(page);
    await workViewPage.waitForTaskList();
    await projectPage.createAndGoToTestProject();
    const projectId = await currentProjectId(page);
    await addProvider(page, projectId, { createOnServer: true, deleteOnServer: true });

    const title = `${testPrefix}-VTODO create`;
    await workViewPage.addTask(title);

    // --- One VTODO, named after its SP-derived UID, never overwriting ---
    await expect.poll(() => stub.todos.length, { timeout: 20000 }).toBe(1);
    await expect
      .poll(async () => (await tasksTitled(page, title)).map((t) => t.issueType))
      .toEqual(['CALDAV']);
    const [linked] = await tasksTitled(page, title);
    const uid = `sp-todo-${linked.id}@super-productivity`;
    expect(linked.issueId).toBe(uid);
    expect(stub.puts).toHaveLength(1);
    expect(stub.puts[0].path).toBe(`${CALENDAR_PATH}${uid}.ics`);
    expect(stub.puts[0].ifNoneMatch).toBe('*');
    expect(stub.puts[0].body).toContain(`UID:${uid}`);
    expect(stub.puts[0].body).toContain(`SUMMARY:${title}`);
    expect(stub.puts[0].body).toContain(`CATEGORIES:${CATEGORY}`);

    // --- A later import poll, after the link landed, keeps it single ---
    // The foreign VTODO is imported in the same pass, so once it shows up that
    // pass has finished and a duplicate would already be there.
    stub.todos.push(foreignTodo('e2e-marker-1', `${testPrefix}-Marker`));
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Marker` }),
    ).toHaveCount(1, { timeout: 30000 });
    await expect(page.locator('task').filter({ hasText: title })).toHaveCount(1);
    expect(await tasksTitled(page, title)).toHaveLength(1);

    // --- Delete: the VTODO goes once the undo window has passed ---
    await deleteTaskViaUi(page, title);
    await expect
      .poll(() => stub.deletes, { timeout: UNDO_WINDOW_PLUS_MARGIN_MS + 10000 })
      .toEqual([{ path: `${CALENDAR_PATH}${uid}.ics`, ifMatch: '"e2e-1"' }]);
    expect(stub.todos.map((t) => t.path)).toEqual([`${CALENDAR_PATH}e2e-marker-1.ics`]);
  });

  test('writes nothing to the server with the settings at their defaults', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    const stub = await stubCaldav(page);
    await workViewPage.waitForTaskList();
    await projectPage.createAndGoToTestProject();
    const projectId = await currentProjectId(page);
    await addProvider(page, projectId, undefined);
    // An existing VTODO, imported and linked by the poll.
    stub.todos.push(foreignTodo('e2e-foreign-1', `${testPrefix}-Foreign`));

    await workViewPage.addTask(`${testPrefix}-Local only`);
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Foreign` }),
    ).toHaveCount(1, { timeout: 30000 });

    await deleteTaskViaUi(page, `${testPrefix}-Foreign`);
    await deleteTaskViaUi(page, `${testPrefix}-Local only`);
    // Wait past the undo window; a remote delete would have fired by now.
    await page.waitForTimeout(UNDO_WINDOW_PLUS_MARGIN_MS);

    expect(stub.puts).toEqual([]);
    expect(stub.deletes).toEqual([]);
  });
});
