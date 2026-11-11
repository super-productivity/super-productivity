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
import { flushPendingWrites, waitForAppReady } from '../../utils/waits';

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

const expectUnlinked = async (page: Page, id: string): Promise<void> => {
  const task = (await tasks(page)).find((candidate) => candidate.id === id);
  expect(task).toBeDefined();
  expect(task?.issueProviderId).toBeUndefined();
  expect(task?.issueId).toBeUndefined();
  expect(task?.issueType).toBeUndefined();
  expect(task?.issueLastSyncedValues).toBeUndefined();
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
    test(`${bulk ? 'bulk' : 'single'} delete unlinks replay-state tasks and restore drops archived links`, async ({
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
        const provider: IssueProviderCalendar = {
          id: 'deleted-calendar',
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
        };
        await dispatch(origin.page, {
          type: '[IssueProvider/API] Add IssueProvider',
          issueProvider: provider,
          meta: {
            isPersistent: true,
            entityType: 'ISSUE_PROVIDER',
            entityId: provider.id,
            opType: 'CRT',
          },
        });
        await origin.workView.addTask('Active linked task');
        await origin.workView.addTask('Archived linked task');
        const initialTasks = await tasks(origin.page);
        for (const task of initialTasks) {
          await dispatch(origin.page, {
            type: '[Task Shared] updateTask',
            task: {
              id: task.id,
              changes: {
                issueProviderId: provider.id,
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
        }
        const linkedTasks = await tasks(origin.page);
        const active = linkedTasks.find((t) => t.title === 'Active linked task')!;
        const archived = linkedTasks.find((t) => t.title === 'Archived linked task')!;
        await dispatch(origin.page, {
          type: '[Task Shared] moveToArchive',
          tasks: [{ ...archived, isDone: true, subTasks: [] }],
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

        // A remote replay can see tasks that were not in the sender's unlink list.
        await dispatch(origin.page, {
          type: `[Task Shared] ${bulk ? 'deleteIssueProviders' : 'deleteIssueProvider'}`,
          ...(bulk ? { ids: [provider.id] } : { issueProviderId: provider.id }),
          taskIdsToUnlink: [],
          meta: {
            isPersistent: true,
            entityType: 'ISSUE_PROVIDER',
            ...(bulk
              ? { entityIds: [provider.id], isBulk: true }
              : { entityId: provider.id }),
            opType: 'DEL',
          },
        });
        await expectUnlinked(origin.page, active.id);
        await origin.sync.syncAndWait();
        await peer.sync.syncAndWait();
        await expectUnlinked(peer.page, active.id);

        await dispatch(origin.page, {
          type: '[Task Shared] restoreTask',
          task: archived,
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
});
