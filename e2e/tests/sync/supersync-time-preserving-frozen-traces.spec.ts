import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import fixtures from '../../../src/app/op-log/testing/integration/sync-fuzz/time-preserving-resolution.fixtures.json';

const blockBackgroundSync = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

/** Call real persistence services through the hook available in optimized E2E builds. */
const persist = (page: Page, compact = false): Promise<void> =>
  page.evaluate(async (shouldCompact) => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          flushPendingWrites: () => Promise<void>;
          compact: () => Promise<boolean>;
        };
      }
    ).__e2eTestHelpers;
    await helpers.flushPendingWrites();
    if (shouldCompact) await helpers.compact();
  }, compact);

interface TaskView {
  id: string;
  title: string;
  notes?: string;
  isDone: boolean;
  dueDay?: string;
  timeSpent: number;
  timeSpentOnDay: Record<string, number>;
  tagIds: string[];
  projectId: string;
}
interface StateView {
  tasks: { entities: Record<string, TaskView> };
  tag: { entities: Record<string, { taskIds: string[] }> };
  timeTracking: {
    tag: Record<string, Record<string, unknown>>;
    project: Record<string, Record<string, unknown>>;
  };
}

const read = (page: Page): Promise<StateView> =>
  page.evaluate(() => {
    let state!: StateView;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (s: StateView) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return state;
  });

/** The frozen harness's UI-reachable actions, using the current task payload. */
const act = async (
  page: Page,
  id: string,
  kind: string,
  value: unknown,
): Promise<void> => {
  await page.evaluate(
    async ({ taskId, action, input }) => {
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              dispatch: (a: unknown) => void;
              subscribe: (fn: (s: StateView) => void) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers.store;
      const state = (): StateView => {
        let current!: StateView;
        store.subscribe((s) => (current = s)).unsubscribe();
        return current;
      };
      const task = state().tasks.entities[taskId];
      if (!task) throw new Error(`Frozen trace target missing: ${taskId}`);
      const update = (changes: Record<string, unknown>): void =>
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: taskId, changes },
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: taskId,
            opType: 'UPD',
          },
        });
      if (action === 'track') {
        if (task.isDone) update({ isDone: false });
        const date = new Date().toLocaleDateString('en-CA');
        store.dispatch({
          type: '[TimeTracking] Add time spent',
          task,
          date,
          duration: input,
          isFromTrackingReminder: false,
        });
        // The app's default auto-plan effect emits planTasksForToday here.
        await new Promise((resolve) => setTimeout(resolve, 0));
        store.dispatch({
          type: '[TimeTracking] Sync time spent',
          taskId,
          date,
          duration: input,
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: taskId,
            opType: 'UPD',
          },
        });
        const tracked = state().timeTracking;
        for (const [contextType, contextId] of [
          ['PROJECT', task.projectId],
          ['TAG', 'TODAY'],
        ]) {
          const data = (contextType === 'TAG' ? tracked.tag : tracked.project)[
            contextId
          ]?.[date];
          if (data)
            store.dispatch({
              type: '[TimeTracking] Sync sessions',
              contextType,
              contextId,
              date,
              data,
              meta: {
                isPersistent: true,
                entityType: 'TIME_TRACKING',
                entityId: `${contextType}:${contextId}:${date}`,
                opType: 'UPD',
              },
            });
        }
      } else if (action === 'unschedule') {
        store.dispatch({
          type: '[Task Shared] unscheduleTask',
          id: taskId,
          isSkipToast: true,
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: taskId,
            opType: 'UPD',
          },
        });
      } else {
        update(
          action === 'renameTask'
            ? { title: input }
            : action === 'editTaskNotes'
              ? { notes: input }
              : input
                ? { isDone: true, doneOn: Date.now() }
                : { isDone: false },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    { taskId: id, action: kind, input: value },
  );
  await persist(page);
};

test.describe('@supersync original frozen time and restart traces (#10499)', () => {
  for (const fixture of fixtures) {
    test(fixture.name, async ({ browser, baseURL, testRunId }, testInfo) => {
      test.setTimeout(600000);
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const ids: Record<string, string> = {};
        for (const name of ['A', 'B', 'C']) {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.page.evaluate(blockBackgroundSync);
          await client.page.addInitScript(blockBackgroundSync);
          await client.sync.setupSuperSync(config);
          if (name === 'A') {
            for (const task of ['t1', 't2', 't3']) {
              await client.workView.addTask(task);
              ids[task] = Object.values((await read(client.page)).tasks.entities).find(
                (t) => t.title.endsWith(task),
              )!.id;
            }
            await act(client.page, ids.t3, 'unschedule', null);
          }
          await client.sync.syncAndWait();
        }
        const restart = async (client: SimulatedE2EClient): Promise<void> => {
          await persist(client.page);
          await client.page.reload({ waitUntil: 'domcontentloaded' });
          await waitForAppReady(client.page);
        };
        for (const [index, step] of fixture.steps.entries()) {
          const client = clients['ABC'.indexOf(step.d)];
          const [kind, target, value] = step.a;
          console.log(`${fixture.name} step${index} ${step.d} ${JSON.stringify(step.a)}`);
          await act(client.page, ids[String(target)], String(kind), value);
          if (step.s) await client.sync.syncAndWait();
          if ('c' in step && step.c) await persist(client.page, true);
          if (step.r) await restart(client);
        }
        for (let round = 0; round < 6; round++) {
          for (const client of clients) await client.sync.syncAndWait();
        }
        const before = await Promise.all(clients.map((client) => read(client.page)));
        await testInfo.attach('before-restart.json', {
          body: JSON.stringify(before),
          contentType: 'application/json',
        });
        // 07's exact harmful residual: 3000 + 3000 + 1000 tracked on t3.
        if (fixture.name === '20725007') {
          for (const state of before)
            expect(state.tasks.entities[ids.t3].timeSpent).toBe(7000);
        }
        // Rebasing an older resolution snapshot must not override B's later notes.
        if (fixture.name === '20725008-notes-order') {
          for (const state of before)
            expect(state.tasks.entities[ids.t3]['notes']).toBe('B27');
        }
        // Kept local-win deltas must not move beyond the snapshot containing them.
        if (fixture.name === '20725013-delta-order') {
          for (const state of before) {
            expect(state.tasks.entities[ids.t3].timeSpent).toBe(15000);
            expect(state.tasks.entities[ids.t3]['title']).toBe('B17');
          }
        }
        // Compare each device to itself: seed23 has an independent pre-existing
        // B-vs-fresh residue, which must not mask C's introduced restart change.
        for (const [index, client] of clients.entries()) {
          await restart(client);
          const after = await read(client.page);
          await testInfo.attach(`${'ABC'[index]}-after-restart.json`, {
            body: JSON.stringify(after),
            contentType: 'application/json',
          });
          expect(after.tag.entities.TODAY.taskIds).toEqual(
            before[index].tag.entities.TODAY.taskIds,
          );
          for (const id of Object.values(ids)) {
            // Replay stamps modified at apply time. Missing and undefined
            // optional fields are equivalent; every other field must match.
            const content = (task: TaskView): Record<string, unknown> =>
              Object.fromEntries(
                Object.entries(task).filter(
                  ([key, value]) => key !== 'modified' && value !== undefined,
                ),
              );
            expect(content(after.tasks.entities[id])).toEqual(
              content(before[index].tasks.entities[id]),
            );
          }
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
