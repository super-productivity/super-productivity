import type { Page } from '@playwright/test';
import type { Task } from '../../../src/app/features/tasks/task.model';
import type { IssueProviderCalendar } from '../../../src/app/features/issue/issue.model';
import { expect, test } from '../../fixtures/supersync.fixture';
import { test as localTest } from '../../fixtures/test.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { allowDevErrorsInCurrentTest } from '../../utils/runtime-errors';
import { flushPendingWrites, waitForAppReady } from '../../utils/waits';

/**
 * #8147: deleting an issue provider must clear issue fields on every task that
 * still points at it in the receiving client's state, not only the ids the
 * origin packed into `taskIdsToUnlink`. Restoring an archived task whose
 * provider is gone must drop the link before active-state validation.
 *
 * The concurrent crossing is the case the unlink list cannot cover: origin
 * deletes with an empty list (no linked tasks locally) while the peer links a
 * task to that provider. Both upload orders leave both clients unlinked with
 * the task content intact. Origin applying the peer's still-linked task op
 * after the provider is gone produces a local full-state REPAIR; the peer
 * unlinks via the delete replay state scan without creating one.
 */

const dispatch = (page: Page, action: Record<string, unknown>): Promise<void> =>
  page.evaluate((value) => {
    (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store.dispatch(value);
  }, action);

const tasks = (page: Page): Promise<Task[]> =>
  page.evaluate(() => {
    let result: Task[] = [];
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              fn: (s: { tasks: { entities: Record<string, Task> } }) => void,
            ) => {
              unsubscribe: () => void;
            };
          };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((state) => (result = Object.values(state.tasks.entities)))
      .unsubscribe();
    return result;
  });

const taskByTitleSuffix = async (page: Page, suffix: string): Promise<Task> => {
  const task = (await tasks(page)).find((candidate) => candidate.title.endsWith(suffix));
  expect(task, `task ending with "${suffix}"`).toBeDefined();
  return task!;
};

const expectUnlinked = async (page: Page, id: string): Promise<void> => {
  const task = (await tasks(page)).find((candidate) => candidate.id === id);
  expect(task).toBeDefined();
  expect(task?.issueProviderId).toBeUndefined();
  expect(task?.issueId).toBeUndefined();
  expect(task?.issueType).toBeUndefined();
  expect(task?.issueLastSyncedValues).toBeUndefined();
};

const setWsDownloadBlocked = async (
  client: SimulatedE2EClient,
  blocked: boolean,
): Promise<void> => {
  await client.page.evaluate((b) => {
    (
      globalThis as unknown as { __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean }
    ).__SP_E2E_BLOCK_WS_DOWNLOAD = b;
  }, blocked);
};

/** Locally created REPAIR/import rows only (remote full-state ops are excluded). */
const localFullStateOpCount = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const rows = await new Promise<{ source?: string; op: { o: string } }[]>(
        (resolve, reject) => {
          const r = db.transaction('ops').objectStore('ops').getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        },
      );
      return rows.filter(
        (row) =>
          row.source === 'local' &&
          ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(row.op.o),
      ).length;
    } finally {
      db.close();
    }
  });

const calendarProvider = (id: string): IssueProviderCalendar => ({
  id,
  issueProviderKey: 'ICAL',
  isEnabled: false,
  isAutoPoll: false,
  isAutoAddToBacklog: false,
  isIntegratedAddTaskBar: false,
  defaultProjectId: 'INBOX_PROJECT',
  defaultTagIds: [],
  pinnedSearch: null,
  icalUrl: '',
  isAutoImportForCurrentDay: false,
  isReferenceCalendar: false,
  checkUpdatesEvery: 7200000,
  showBannerBeforeThreshold: 7200000,
  isDisabledForWebApp: false,
  filterIncludeRegex: null,
  filterExcludeRegex: null,
});

const addProvider = async (
  page: Page,
  provider: IssueProviderCalendar,
): Promise<void> => {
  await dispatch(page, {
    type: '[IssueProvider/API] Add IssueProvider',
    issueProvider: provider,
    meta: {
      isPersistent: true,
      entityType: 'ISSUE_PROVIDER',
      entityId: provider.id,
      opType: 'CRT',
    },
  });
};

const linkTaskToProvider = async (
  page: Page,
  task: Task,
  providerId: string,
): Promise<void> => {
  await dispatch(page, {
    type: '[Task Shared] updateTask',
    task: {
      id: task.id,
      changes: {
        issueProviderId: providerId,
        issueId: `event-${task.id}`,
        issueType: 'ICAL',
        issueLastSyncedValues: { title: task.title },
      },
    },
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: task.id,
      opType: 'UPD',
    },
  });
};

const deleteProvider = async (
  page: Page,
  providerId: string,
  taskIdsToUnlink: string[],
  bulk: boolean,
): Promise<void> => {
  await dispatch(page, {
    type: `[Task Shared] ${bulk ? 'deleteIssueProviders' : 'deleteIssueProvider'}`,
    ...(bulk ? { ids: [providerId] } : { issueProviderId: providerId }),
    taskIdsToUnlink,
    meta: {
      isPersistent: true,
      entityType: 'ISSUE_PROVIDER',
      ...(bulk ? { entityIds: [providerId], isBulk: true } : { entityId: providerId }),
      opType: 'DEL',
    },
  });
};

localTest(
  'local restore clears a deleted issue provider before persistence and replay',
  async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Archived issue task');
    const task = (await tasks(page))[0];
    const archived: Task = {
      ...task,
      isDone: true,
      issueProviderId: 'deleted-provider',
      issueId: 'old-issue',
      issueType: 'JIRA',
      issueLastSyncedValues: { title: 'Old issue title' },
    };
    await dispatch(page, {
      type: '[Task Shared] moveToArchive',
      tasks: [{ ...archived, subTasks: [] }],
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: [task.id],
        opType: 'UPD',
        isBulk: true,
      },
    });
    expect(await tasks(page)).toHaveLength(0);
    await dispatch(page, {
      type: '[Task Shared] restoreTask',
      task: archived,
      subTasks: [],
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: [task.id],
        opType: 'UPD',
        isBulk: true,
      },
    });
    await expectUnlinked(page, task.id);
    await flushPendingWrites(page);
    await page.reload();
    await waitForAppReady(page);
    await expectUnlinked(page, task.id);
  },
);

test.describe('@supersync Stale issue provider references (#8147)', () => {
  for (const bulk of [false, true]) {
    test(`${bulk ? 'bulk' : 'single'} delete unlinks known tasks and restore drops archived links`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.slow();
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        for (const name of ['A', 'B']) {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.workView.waitForTaskList();
          await client.sync.setupSuperSync(config);
        }
        const [origin, peer] = clients;
        const provider = calendarProvider('deleted-calendar');
        await addProvider(origin.page, provider);
        await origin.workView.addTask('Active linked task');
        await origin.workView.addTask('Archived linked task');
        const active = await taskByTitleSuffix(origin.page, 'Active linked task');
        const archived = await taskByTitleSuffix(origin.page, 'Archived linked task');
        await linkTaskToProvider(origin.page, active, provider.id);
        await linkTaskToProvider(origin.page, archived, provider.id);
        await dispatch(origin.page, {
          type: '[Task Shared] moveToArchive',
          tasks: [
            {
              ...(await taskByTitleSuffix(origin.page, 'Archived linked task')),
              isDone: true,
              subTasks: [],
            },
          ],
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityIds: [archived.id],
            opType: 'UPD',
            isBulk: true,
          },
        });
        await origin.sync.syncAndWait();
        await peer.sync.syncAndWait();

        // Match the app: unlink every currently linked active task.
        await deleteProvider(origin.page, provider.id, [active.id], bulk);
        await expectUnlinked(origin.page, active.id);
        await origin.sync.syncAndWait();
        await peer.sync.syncAndWait();
        await expectUnlinked(peer.page, active.id);

        await dispatch(origin.page, {
          type: '[Task Shared] restoreTask',
          task: {
            ...archived,
            isDone: true,
            issueProviderId: provider.id,
            issueId: `event-${archived.id}`,
            issueType: 'ICAL',
            issueLastSyncedValues: { title: archived.title },
          },
          subTasks: [],
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityIds: [archived.id],
            opType: 'UPD',
            isBulk: true,
          },
        });
        // Normalize in the restore reducer, before Checkpoint D could repair it.
        await expectUnlinked(origin.page, archived.id);
        await origin.sync.syncAndWait();
        await peer.sync.syncAndWait();
        for (const client of clients) {
          await expectUnlinked(client.page, archived.id);
          await flushPendingWrites(client.page);
          await client.page.reload();
          await waitForAppReady(client.page);
          await expectUnlinked(client.page, active.id);
          await expectUnlinked(client.page, archived.id);
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }

  for (const order of ['delete syncs first', 'link syncs first'] as const) {
    test(`concurrent provider delete vs peer link converge unlinked (${order})`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.slow();
      // Origin can briefly hold a dangling link before validation REPAIR.
      allowDevErrorsInCurrentTest(/issueProviderId from task not existing/);
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        for (const name of ['A', 'B']) {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.workView.waitForTaskList();
          await client.sync.setupSuperSync(config);
        }
        const [origin, peer] = clients;
        const provider = calendarProvider('crossing-calendar');
        await addProvider(origin.page, provider);
        await origin.sync.syncAndWait();
        await peer.sync.syncAndWait();

        // Keep the edits concurrent: neither client may pull the other's op
        // before acting. All later downloads go through explicit syncs.
        await setWsDownloadBlocked(origin, true);
        await setWsDownloadBlocked(peer, true);

        // Peer links a task the origin never knew about, so the delete's
        // taskIdsToUnlink (built from origin's tasks) cannot cover it.
        await peer.workView.addTask('Concurrently linked task');
        const linked = await taskByTitleSuffix(peer.page, 'Concurrently linked task');
        const linkedTitle = linked.title;
        await linkTaskToProvider(peer.page, linked, provider.id);

        // Origin deletes with an empty unlink list — the only shape the app
        // can produce when it has no local linked tasks.
        await deleteProvider(origin.page, provider.id, [], false);

        if (order === 'delete syncs first') {
          await origin.sync.syncAndWait();
          await peer.sync.syncAndWait();
          await origin.sync.syncAndWait();
        } else {
          await peer.sync.syncAndWait();
          await origin.sync.syncAndWait();
          await peer.sync.syncAndWait();
        }
        // One extra round for eventual consistency / post-sync REPAIR upload.
        await origin.sync.syncAndWait();
        await peer.sync.syncAndWait();

        for (const client of clients) {
          const task = (await tasks(client.page)).find((t) => t.id === linked.id);
          expect(task, `${client.clientName} kept the task`).toBeDefined();
          expect(task?.title).toBe(linkedTitle);
          await expectUnlinked(client.page, linked.id);
        }

        const repairOrigin = await localFullStateOpCount(origin.page);
        const repairPeer = await localFullStateOpCount(peer.page);
        const described = JSON.stringify({ order, repairOrigin, repairPeer });
        console.log(`[8147-crossing] ${described}`);
        test.info().annotations.push({
          type: `8147-crossing-${order}`,
          description: described,
        });
        // Origin receives the peer's still-linked task op after the provider
        // is gone and validation writes a REPAIR; peer unlinks via the delete
        // replay state scan and does not create its own.
        expect({ repairOrigin, repairPeer }, `local REPAIR counts (${order})`).toEqual({
          repairOrigin: 1,
          repairPeer: 0,
        });
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
