import type { ConsoleMessage, Page, Route } from '@playwright/test';
import type { IssueProviderCaldav } from '../../../src/app/features/issue/issue.model';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createProjectReliably,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  navigateToWorkView,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync + CalDAV date push (#10099): a CalDAV poll must not write a
 * multi-task op that races a concurrent edit from another device.
 *
 * Tasks linked before date push existed have no `dtstart`/`due` in
 * `issueLastSyncedValues`. A poll that writes those baselines for several
 * tasks in ONE bulk op makes conflict resolution throw
 * `SYNC_MULTI_ENTITY_UNSUPPORTED` against a concurrent edit of one of those
 * tasks on another device, in both directions:
 * 1. A's poll result is pending when B's edit arrives (side=local).
 * 2. A's poll result arrives while B's edit is pending (side=remote).
 *
 * The CalDAV server is mocked with `page.route` on both clients (both devices
 * would poll the same server). Client B stays on the Today view, where the
 * future-dated linked tasks are not in context, so only A polls. B edits the
 * time estimate, a field CalDAV does not map, so no poll or push touches it.
 * B edits through the store with the `updateTask` op the task UI dispatches:
 * opening the project on B would start B's own poll.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 */

const CALDAV_ORIGIN = 'https://caldav.example.invalid';
const PRINCIPAL_PATH = '/principals/e2e/';
const HOME_PATH = '/calendars/e2e/';
const CALENDAR_PATH = '/calendars/e2e/tasks/';
const CALENDAR_NAME = 'E2E Tasks';

interface Todo {
  uid: string;
  summary: string;
  dueDay: string;
  etag: string;
}

/**
 * Same pure function as `CaldavClientService._hashEtag`
 * (src/app/features/issue/providers/caldav/caldav-client.service.ts:280), so
 * `issueLastUpdated` matches and the poll sees an unchanged ETag.
 */
const hashEtag = (etag: string): number => {
  let hash = 0;
  for (let i = 0; i < etag.length; i++) {
    hash = (hash << 5) - hash + etag.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};

/** Local YYYY-MM-DD, `days` from today. Future, so it is not in Today's list. */
const localDateStr = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

const multistatus = (responses: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">' +
  responses +
  '</d:multistatus>';

const okResponse = (href: string, props: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>` +
  '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

const vtodo = (todo: Todo): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//E2E//CalDAV mock//EN',
    'BEGIN:VTODO',
    `UID:${todo.uid}`,
    'DTSTAMP:20260101T000000Z',
    `SUMMARY:${todo.summary}`,
    `DTSTART;VALUE=DATE:${todo.dueDay.replace(/-/g, '')}`,
    'STATUS:NEEDS-ACTION',
    'END:VTODO',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Minimal CalDAV server for `@nextcloud/cdav-library` `connect` +
 * `calendarQuery`: principal discovery, principal props, calendar home
 * listing, and a VTODO REPORT. Returns per-method request counts.
 */
const mockCaldavServer = async (
  page: Page,
  todos: Todo[],
): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  await page.route(`${CALDAV_ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const depth = request.headers()['depth'];
    counts[method] = (counts[method] ?? 0) + 1;
    // HTTP header names, not identifiers.
    /* eslint-disable @typescript-eslint/naming-convention */
    const cors = {
      'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
      'Access-Control-Allow-Methods': 'GET, PUT, PROPFIND, REPORT, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Depth, X-Requested-With, If-Match, Prefer',
      'Access-Control-Expose-Headers': 'DAV, ETag',
    };
    const davHeaders = {
      ...cors,
      DAV: '1, 2, 3, calendar-access',
      'Content-Type': 'application/xml; charset=utf-8',
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    let body: string | null = null;
    if (method === 'PROPFIND' && path === '/') {
      body = multistatus(
        okResponse(
          '/',
          `<d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal>`,
        ),
      );
    } else if (method === 'PROPFIND' && path === PRINCIPAL_PATH) {
      body = multistatus(
        okResponse(
          PRINCIPAL_PATH,
          '<d:displayname>e2e</d:displayname>' +
            `<cal:calendar-home-set><d:href>${HOME_PATH}</d:href></cal:calendar-home-set>` +
            '<d:principal-collection-set><d:href>/principals/</d:href></d:principal-collection-set>',
        ),
      );
    } else if (method === 'PROPFIND' && path === HOME_PATH && depth === '1') {
      body = multistatus(
        okResponse(HOME_PATH, '<d:resourcetype><d:collection/></d:resourcetype>') +
          okResponse(
            CALENDAR_PATH,
            `<d:displayname>${CALENDAR_NAME}</d:displayname>` +
              '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>',
          ),
      );
    } else if (method === 'REPORT' && path === CALENDAR_PATH) {
      body = multistatus(
        todos
          .map((todo) =>
            okResponse(
              `${CALENDAR_PATH}${todo.uid}.ics`,
              '<d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>' +
                `<d:getetag>${escapeXml(todo.etag)}</d:getetag>` +
                `<cal:calendar-data>${escapeXml(vtodo(todo))}</cal:calendar-data>`,
            ),
          )
          .join(''),
      );
    }
    if (body === null) {
      console.log(`[CaldavMock] Unhandled ${method} ${path} depth=${depth}`);
      await route.fulfill({ status: 404, headers: cors, body: '' });
      return;
    }
    await route.fulfill({
      status: 207,
      headers: davHeaders,
      body,
    });
  });
  return counts;
};

const dispatch = async (
  page: Page,
  actions: Record<string, unknown>[],
): Promise<void> => {
  await page.evaluate(async (items) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    for (const item of items) store.dispatch(item);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, actions);
};

interface StateSnapshot {
  projectIdByTitle: Record<string, string>;
  taskTitles: Record<string, string>;
  taskEstimates: Record<string, number>;
}
const readState = (page: Page): Promise<StateSnapshot> =>
  page.evaluate(() => {
    type State = {
      projects: { entities: Record<string, { id: string; title: string }> };
      tasks: {
        entities: Record<string, { id: string; title: string; timeEstimate: number }>;
      };
    };
    let state!: State;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (s: State) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return {
      projectIdByTitle: Object.fromEntries(
        Object.values(state.projects.entities).map((p) => [p.title, p.id]),
      ),
      taskTitles: Object.fromEntries(
        Object.values(state.tasks.entities).map((t) => [t.id, t.title]),
      ),
      taskEstimates: Object.fromEntries(
        Object.values(state.tasks.entities).map((t) => [t.id, t.timeEstimate]),
      ),
    };
  });

/** The `{ taskCount, taskIds }` payload of the poll's console log, if any. */
const pollPayload = async (
  msg: ConsoleMessage,
): Promise<{ taskCount: number; taskIds: string[] } | undefined> => {
  for (const arg of msg.args()) {
    const value = (await arg.jsonValue()) as { taskIds?: unknown } | null;
    if (value && typeof value === 'object' && Array.isArray(value.taskIds)) {
      return value as { taskCount: number; taskIds: string[] };
    }
  }
  return undefined;
};

/**
 * Strict sync: unlike `syncAndWait`, which answers a conflict dialog with
 * "use remote", this reports the dialog (or an error state) as a failure.
 */
const syncOutcome = async (client: SimulatedE2EClient): Promise<string> => {
  const downloaded = client.page.waitForResponse(
    (r) => r.url().includes('/api/sync/ops') && r.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  let outcome = 'pending';
  await expect
    .poll(
      async () => {
        outcome = (await client.sync.conflictDialog.isVisible())
          ? 'conflict-dialog'
          : (await client.sync.hasSyncError())
            ? 'error'
            : !(await client.sync.syncSpinner.isVisible()) &&
                (await client.sync.syncCheckIcon
                  .filter({ hasText: /^done_all$/ })
                  .isVisible())
              ? 'in-sync'
              : 'pending';
        return outcome;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  return outcome;
};

test.describe('@supersync CalDAV date baselines vs concurrent edit (#10099)', () => {
  for (const direction of ['poll-pending', 'edit-pending'] as const) {
    test(`CalDAV poll does not wedge sync against a concurrent edit (${direction}) @supersync`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(240000);
      const uniqueId = Date.now();
      const providerId = `caldav-e2e-${uniqueId}`;
      const projectName = `CaldavBaseline-${uniqueId}`;
      const todos: Todo[] = [1, 2].map((n) => ({
        uid: `e2e-vtodo-${n}-${uniqueId}`,
        summary: `CaldavBaseline-T${n}-${uniqueId}`,
        dueDay: localDateStr(20 + n),
        etag: `"e2e-etag-${n}-${uniqueId}"`,
      }));
      const taskIds = todos.map((_, i) => `caldav-task-${i + 1}-${uniqueId}`);
      // Not mapped by CalDAV: neither a poll nor a push touches it.
      const estimateOnB = 30 * 60 * 1000;
      const multiEntityLogs: string[] = [];
      const pollErrorsA: string[] = [];
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      const watchConsole = (client: SimulatedE2EClient): void => {
        client.page.on('console', (msg) => {
          const text = msg.text();
          if (text.includes('SYNC_MULTI_ENTITY_UNSUPPORTED')) {
            multiEntityLogs.push(`[${client.clientName}] ${text}`);
          }
          // The poll swallows its own errors (poll-issue-updates.effects.ts):
          // a throwing poll would otherwise look like a quiet, green one.
          if (client === clientA && text.includes('Error polling issue updates')) {
            pollErrorsA.push(text);
          }
        });
      };
      const sync = async (client: SimulatedE2EClient, label: string): Promise<void> => {
        const outcome = await syncOutcome(client);
        console.log(`[CaldavBaseline] ${label}: ${outcome}`);
        expect(
          { outcome, multiEntityLogs },
          `${label}: sync must complete without a conflict`,
        ).toEqual({ outcome: 'in-sync', multiEntityLogs: [] });
      };

      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));

        // ============ Seed on A: project, CalDAV provider, two linked tasks ====
        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        watchConsole(clientA);
        const caldavA = await mockCaldavServer(clientA.page, todos);
        await clientA.sync.setupSuperSync(syncConfig);
        await createProjectReliably(clientA.page, projectName);
        await expect
          .poll(
            async () => (await readState(clientA!.page)).projectIdByTitle[projectName],
          )
          .toBeTruthy();
        const projectId = (await readState(clientA.page)).projectIdByTitle[projectName];
        // Today's context holds none of the future-dated tasks, so seeding
        // cannot start a poll that covers them.
        await navigateToWorkView(clientA);

        const provider: IssueProviderCaldav = {
          id: providerId,
          issueProviderKey: 'CALDAV',
          isEnabled: true,
          isAutoPoll: true,
          isAutoAddToBacklog: false,
          isIntegratedAddTaskBar: false,
          defaultProjectId: projectId,
          pinnedSearch: null,
          pollingMode: 'whenProjectOpen',
          defaultTagIds: [],
          defaultNote: null,
          caldavUrl: `${CALDAV_ORIGIN}/`,
          resourceName: CALENDAR_NAME,
          username: 'synthetic-user',
          password: 'synthetic-only-not-a-credential',
          categoryFilter: null,
          twoWaySync: {
            isDone: 'pullOnly',
            title: 'pullOnly',
            notes: 'off',
            plannedDate: 'both',
            deadline: 'both',
          },
        };
        await dispatch(clientA.page, [
          {
            type: '[IssueProvider/API] Add IssueProvider',
            issueProvider: provider,
            meta: {
              isPersistent: true,
              entityType: 'ISSUE_PROVIDER',
              entityId: providerId,
              opType: 'CRT',
            },
          },
          ...todos.map((todo, i) => ({
            type: '[Task Shared] addTask',
            task: {
              id: taskIds[i],
              projectId,
              title: todo.summary,
              subTaskIds: [],
              timeSpentOnDay: {},
              timeSpent: 0,
              timeEstimate: 0,
              isDone: false,
              tagIds: [],
              created: Date.now(),
              attachments: [],
              dueDay: todo.dueDay,
              issueId: todo.uid,
              issueProviderId: providerId,
              issueType: 'CALDAV',
              issueWasUpdated: false,
              issueLastUpdated: hashEtag(todo.etag),
              // Linked before date push existed: no dtstart/due baseline.
              issueLastSyncedValues: { completed: false, summary: todo.summary },
            },
            workContextId: projectId,
            workContextType: 'PROJECT',
            isAddToBacklog: false,
            isAddToBottom: true,
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: taskIds[i],
              opType: 'CRT',
            },
          })),
        ]);
        await expect
          .poll(async () => (await readState(clientA!.page)).taskTitles[taskIds[1]])
          .toBe(todos[1].summary);
        await clientA.sync.syncAndWait();

        // ============ B receives everything ===================================
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        watchConsole(clientB);
        const caldavB = await mockCaldavServer(clientB.page, todos);
        await clientB.sync.setupSuperSync(syncConfig);
        await clientB.sync.syncAndWait();
        await expect
          .poll(async () => (await readState(clientB!.page)).taskTitles)
          .toMatchObject({
            [taskIds[0]]: todos[0].summary,
            [taskIds[1]]: todos[1].summary,
          });
        expect(caldavA.REPORT ?? 0, 'no poll before the race').toBe(0);

        // setupSuperSync already blocks immediate uploads and WS-triggered
        // downloads and closes the WebSocket, so from here on each op leaves a
        // client only through an explicit sync.

        const editOnB = async (): Promise<void> => {
          await dispatch(clientB!.page, [
            {
              type: '[Task Shared] updateTask',
              task: { id: taskIds[0], changes: { timeEstimate: estimateOnB } },
              meta: {
                isPersistent: true,
                entityType: 'TASK',
                entityId: taskIds[0],
                opType: 'UPD',
              },
            },
          ]);
          await expect
            .poll(async () => (await readState(clientB!.page)).taskEstimates[taskIds[0]])
            .toBe(estimateOnB);
          console.log('[CaldavBaseline] B edited the T1 estimate');
        };
        const pollOnA = async (): Promise<void> => {
          const polled = clientA!.page.waitForEvent('console', {
            predicate: (msg) => msg.text().includes('POLLING CHANGES FOR CALDAV'),
            timeout: 30000,
          });
          const report = clientA!.page.waitForResponse(
            (r) => r.url().startsWith(CALDAV_ORIGIN) && r.request().method() === 'REPORT',
            { timeout: 30000 },
          );
          // Opening the project sets the active work context; the poll fires
          // DELAY_BEFORE_ISSUE_POLLING (8 s) later for the project's tasks.
          await clientA!.page.goto(`/#/project/${projectId}/tasks`);
          // The poll covered both linked tasks. (The REPORT body cannot show
          // this: getByIds$ queries the whole calendar and filters locally.)
          const payload = await pollPayload(await polled);
          expect([...(payload?.taskIds ?? [])].sort(), 'poll covers both tasks').toEqual(
            [...taskIds].sort(),
          );
          await report;
          await expect.poll(() => caldavA.REPORT ?? 0, { timeout: 20000 }).toBe(1);
          // The poll maps the VTODOs (and, pre-fix, dispatches) after the
          // response; give that async tail time to finish before syncing.
          await clientA!.page.waitForTimeout(2000);
          expect(pollErrorsA, 'the poll did not throw').toEqual([]);
          console.log('[CaldavBaseline] A polled CalDAV');
        };

        if (direction === 'poll-pending') {
          // A's poll result is pending when B's edit arrives.
          await pollOnA();
          await editOnB();
          await sync(clientB, 'B uploads edit');
          await sync(clientA, 'A syncs with pending poll result');
          await sync(clientB, 'extra round B');
          await sync(clientA, 'extra round A');
        } else {
          // A's poll result arrives while B's edit is pending.
          await editOnB();
          await pollOnA();
          await sync(clientA, 'A uploads poll result');
          await sync(clientB, 'B syncs with pending edit');
          await sync(clientA, 'extra round A');
          await sync(clientB, 'extra round B');
          await sync(clientA, 'extra round A 2');
        }

        // Only A polled: B's context never contained the linked tasks.
        expect(caldavB.REPORT ?? 0, 'B never polled').toBe(0);
        // B's edit converged on both clients; nothing else changed.
        for (const client of [clientA, clientB]) {
          await expect
            .poll(async () => (await readState(client.page)).taskEstimates[taskIds[0]])
            .toBe(estimateOnB);
          const state = await readState(client.page);
          expect(state.taskEstimates[taskIds[1]]).toBe(0);
          expect([state.taskTitles[taskIds[0]], state.taskTitles[taskIds[1]]]).toEqual([
            todos[0].summary,
            todos[1].summary,
          ]);
        }
        await expect(clientA.sync.conflictDialog).toBeHidden();
        await expect(clientB.sync.conflictDialog).toBeHidden();
        expect(multiEntityLogs).toEqual([]);
        expect(pollErrorsA).toEqual([]);
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});
