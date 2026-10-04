import { expect, type Page } from '@playwright/test';
import type { WorkViewPage } from '../pages/work-view.page';
import { waitForAppReady } from './waits';
import {
  expectExactTaskTime,
  recordTaskTimeDelta as recordDelta,
} from './supersync-helpers';

export interface ResolutionClient {
  page: Page;
  workView: WorkViewPage;
  sync: () => Promise<void>;
  close: () => Promise<void>;
}
export type JoinResolutionClient = (name: string) => Promise<ResolutionClient>;
export const blockBackgroundSync = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

const changeTask = async (
  client: ResolutionClient,
  taskTitle: string,
  changeKind: 'plan' | 'schedule' | 'rename' | 'future' | 'notes',
): Promise<void> => {
  await client.page.evaluate(
    ({ title, kind }) => {
      type Root = {
        tasks: { entities: Record<string, { id: string; title: string }> };
        appState: { todayStr: string; startOfNextDayDiffMs: number };
      };
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (f: (root: Root) => void) => { unsubscribe: () => void };
              dispatch: (a: unknown) => void;
            };
          };
        }
      ).__e2eTestHelpers.store;
      let root!: Root;
      const sub = store.subscribe((value) => (root = value));
      sub.unsubscribe();
      const task = Object.values(root.tasks.entities).find((t) =>
        t.title.includes(title),
      )!;
      const meta = {
        isPersistent: true,
        entityType: 'TASK',
        entityId: task.id,
        opType: 'UPD',
      };
      if (kind === 'rename')
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: { title: `${title}-renamed` } },
          meta,
        });
      if (kind === 'future' || kind === 'notes')
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: {
            id: task.id,
            changes:
              kind === 'future'
                ? { dueDay: '2099-01-01', dueWithTime: undefined, remindAt: undefined }
                : { notes: 'Downloaded notes from A' },
          },
          meta,
        });
      if (kind === 'schedule') {
        const dueWithTime = Date.now() + 86400000;
        store.dispatch({
          type: '[Task Shared] scheduleTaskWithTime',
          task,
          dueWithTime,
          remindAt: dueWithTime,
          isMoveToBacklog: false,
          meta,
        });
      }
      if (kind === 'plan')
        store.dispatch({
          type: '[Task Shared] planTasksForToday',
          taskIds: [task.id],
          today: root.appState.todayStr,
          startOfNextDayDiffMs: root.appState.startOfNextDayDiffMs,
          isClearScheduledTime: true,
          meta: { ...meta, entityIds: [task.id], isBulk: true },
        });
    },
    { title: taskTitle, kind: changeKind },
  );
};

const scheduling = (client: ResolutionClient, taskTitle: string): Promise<unknown> =>
  client.page.evaluate(
    ({ title }) => {
      type Root = {
        tasks: {
          entities: Record<
            string,
            { title: string; dueDay?: string; dueWithTime?: number; remindAt?: number }
          >;
        };
      };
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (f: (root: Root) => void) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers.store;
      let root!: Root;
      const sub = store.subscribe((value) => (root = value));
      sub.unsubscribe();
      const task = Object.values(root.tasks.entities).find((t) =>
        t.title.includes(title),
      )!;
      return {
        dueDay: task.dueDay,
        dueWithTime: task.dueWithTime,
        remindAt: task.remindAt,
      };
    },
    { title: taskTitle },
  );

const recordTaskTimeDelta = async (
  client: ResolutionClient,
  name: string,
  duration: number,
): Promise<void> => {
  const date = await client.page.evaluate(() => {
    let state!: { appState: { todayStr: string } };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (s: typeof state) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    store.subscribe((value) => (state = value)).unsubscribe();
    return state.appState.todayStr;
  });
  await recordDelta(client, name, date, duration);
};

export const runReminderClearScenario = async (
  join: JoinResolutionClient,
  title: string,
  firstSync: 'A' | 'B',
): Promise<void> => {
  const clients: ResolutionClient[] = [];
  try {
    for (const name of ['A', 'B', 'C']) {
      const client = await join(name);
      clients.push(client);
      if (name === 'A') {
        await client.workView.addTask(title);
        await changeTask(client, title, 'schedule');
        expect(await scheduling(client, title)).toMatchObject({
          dueWithTime: expect.any(Number),
          remindAt: expect.any(Number),
        });
      }
      await client.sync();
      await client.page.evaluate(blockBackgroundSync);
      await client.page.addInitScript(blockBackgroundSync);
    }
    const [a, b, c] = clients;
    const winner = firstSync === 'A' ? a : b;
    const loser = firstSync === 'A' ? b : a;
    await changeTask(loser, title, 'rename');
    await loser.sync();
    await changeTask(winner, title, 'plan');
    await recordTaskTimeDelta(winner, title, 3000);
    const expectedScheduling = await scheduling(winner, title);
    expect(expectedScheduling).toMatchObject({
      dueDay: expect.any(String),
      dueWithTime: undefined,
      remindAt: undefined,
    });
    const syncOrder = firstSync === 'A' ? [a, b, c] : [b, c, a];
    for (const client of [...syncOrder, ...syncOrder]) await client.sync();
    for (const client of clients) {
      await expectExactTaskTime(client, title, 3000);
      expect(await scheduling(client, title)).toEqual(expectedScheduling);
      await client.page.reload();
      await waitForAppReady(client.page);
      await expectExactTaskTime(client, title, 3000);
      expect(await scheduling(client, title)).toEqual(expectedScheduling);
    }
    const fresh = await join('D');
    clients.push(fresh);
    await fresh.sync();
    await expectExactTaskTime(fresh, title, 3000);
    expect(await scheduling(fresh, title)).toEqual(expectedScheduling);
  } finally {
    for (const client of clients) await client.close();
  }
};

export const runIncomingNotesScenario = async (
  join: JoinResolutionClient,
  title: string,
): Promise<void> => {
  const clients: ResolutionClient[] = [];
  try {
    for (const name of ['A', 'B']) {
      const client = await join(name);
      clients.push(client);
      if (name === 'A') {
        await client.workView.addTask(title);
        await changeTask(client, title, 'future');
      }
      await client.sync();
    }
    const [a, b] = clients;
    await changeTask(a, title, 'plan');
    await changeTask(a, title, 'notes');
    // A dated task short-circuits the default auto-plan effect on B.
    await recordTaskTimeDelta(b, title, 3000);
    await changeTask(b, title, 'rename');
    await a.sync();
    await b.sync();
    for (const client of [a, b, a, b]) await client.sync();
    const assertContent = async (client: ResolutionClient): Promise<void> => {
      const task = await client.page.evaluate((name) => {
        type Task = { title: string; notes?: string; dueDay?: string };
        let state!: { tasks: { entities: Record<string, Task> } };
        const store = (
          window as unknown as {
            __e2eTestHelpers: {
              store: {
                subscribe: (fn: (s: typeof state) => void) => {
                  unsubscribe: () => void;
                };
              };
            };
          }
        ).__e2eTestHelpers.store;
        store.subscribe((value) => (state = value)).unsubscribe();
        return Object.values(state.tasks.entities).find((value) =>
          value.title.includes(name),
        );
      }, title);
      expect(task).toMatchObject({
        title: `${title}-renamed`,
        notes: 'Downloaded notes from A',
        dueDay: '2099-01-01',
      });
      await expectExactTaskTime(client, title, 3000);
    };
    for (const client of clients) {
      await assertContent(client);
      await client.page.reload();
      await waitForAppReady(client.page);
      await assertContent(client);
    }
    const fresh = await join('C');
    clients.push(fresh);
    await fresh.sync();
    await assertContent(fresh);
  } finally {
    for (const client of clients) await client.close();
  }
};
