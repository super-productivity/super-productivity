import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  createProjectReliably,
  waitForTask,
  recordTaskTimeDelta,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * Reproduces the sync fuzz `move` mix's two-step traces in the app
 * (sync-fuzz-pinned-traces.json, classes `move-loses-to-edit` and
 * `move-drops-time`): one device moves a task to another project while a
 * second device renames it or tracks time on it, both offline.
 *
 * `moveToOtherProject` carries the full pre-move task, so its conflict with a
 * `{ id, changes }` edit takes the whole-entity path. The harness shows the
 * later side's snapshot undoing the earlier side's change, on every device or
 * on every device but the one that made it.
 *
 * Each test asserts what a user expects: both devices agree, the task is in
 * the project it was moved to and listed there, and the other device's rename
 * or tracked time is kept.
 */

/** Only explicit syncs run, so every crossing happens in the stated order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

/** Fail on the dataset conflict dialog or an error instead of resolving it. */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  const outcome = async (): Promise<string> => {
    if (await client.sync.conflictDialog.isVisible()) return 'conflict-dialog';
    if (await client.sync.hasSyncError()) return 'error';
    const spinning = await client.sync.syncSpinner.isVisible();
    const checked = await client.sync.syncConfirmedIcon.isVisible();
    return !spinning && checked ? 'in-sync' : 'pending';
  };
  let observed = 'pending';
  await expect
    .poll(
      async () => {
        observed = await outcome();
        return observed;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(observed).toBe('in-sync');
};

interface TaskView {
  title: string;
  /** The title of the task's project. */
  project: string;
  /** The titles of the projects whose task lists contain the task. */
  listedIn: string[];
  timeSpent: number;
}

type TaskAction = { rename: string } | { moveTo: string };

/**
 * Reads the task, after an optional rename or move dispatched through the
 * store with the action the UI dispatches (`TaskService.update`,
 * `TaskService.moveToProject`). The task is found by the stable prefix of its
 * title, the target project by its title.
 */
const onTask = async (
  client: SimulatedE2EClient,
  prefix: string,
  action?: TaskAction,
): Promise<TaskView> =>
  client.page.evaluate(
    async ({ name, act }) => {
      type Subscription = { unsubscribe: () => void };
      type StoreLike = {
        subscribe: (next: (state: unknown) => void) => Subscription;
        dispatch: (action: unknown) => void;
      };
      type Entity = Record<string, unknown>;
      type Slice = { entities?: Record<string, Entity | undefined> };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }
      const read = (): Promise<{ task: Entity; projects: Entity[] }> =>
        new Promise((resolve, reject) => {
          const ref: { current?: Subscription } = {};
          ref.current = store.subscribe((state) => {
            window.setTimeout(() => ref.current?.unsubscribe());
            const root = state as Record<string, Slice | undefined>;
            const entitiesOf = (slice?: Slice): Entity[] =>
              Object.values(slice?.entities ?? {}).filter(
                (value): value is Entity => typeof value === 'object' && value !== null,
              );
            const task = entitiesOf(root.tasks ?? root.task).find((value) =>
              String(value.title).includes(name),
            );
            const projects = entitiesOf(root.projects ?? root.project);
            if (task) {
              resolve({ task, projects });
            } else {
              reject(new Error(`Task not found: ${name}`));
            }
          });
        });
      const meta = (task: Entity): Entity => ({
        isPersistent: true,
        entityType: 'TASK',
        entityId: task.id,
        opType: 'UPD',
      });
      if (act && 'rename' in act) {
        const { task } = await read();
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: { title: act.rename } },
          meta: meta(task),
        });
      } else if (act) {
        const { task, projects } = await read();
        const target = projects.find((project) => project.title === act.moveTo);
        if (!target) {
          throw new Error(`Project not found: ${act.moveTo}`);
        }
        store.dispatch({
          type: '[Task Shared] moveToOtherProject',
          task: { ...task, subTasks: [] },
          targetProjectId: target.id,
          meta: meta(task),
        });
      }
      const { task, projects } = await read();
      const lists = (project: Entity): unknown[] => [
        ...((project.taskIds as unknown[] | undefined) ?? []),
        ...((project.backlogTaskIds as unknown[] | undefined) ?? []),
      ];
      return {
        title: String(task.title),
        project: String(
          projects.find((project) => project.id === task.projectId)?.title ??
            task.projectId,
        ),
        listedIn: projects
          .filter((project) => lists(project).includes(task.id))
          .map((project) => String(project.title))
          .sort(),
        timeSpent: typeof task.timeSpent === 'number' ? task.timeSpent : 0,
      };
    },
    { name: prefix, act: action },
  );

test.describe('@supersync a task move crossing an edit on another device', () => {
  /**
   * One device moves the task to the target project; the other renames it or
   * tracks time on it. A uploads first, so B resolves the conflict.
   * `moveFirst` decides which change is the earlier one (the LWW loser).
   */
  const runCrossing = async (
    {
      browser,
      baseURL,
      testRunId,
    }: {
      browser: Parameters<typeof createSimulatedClient>[0];
      baseURL?: string;
      testRunId: string;
    },
    other: 'rename' | 'time',
    mover: 'A' | 'B',
    moveFirst: boolean,
  ): Promise<void> => {
    const prefix = `Move-${other}-${mover}-${moveFirst ? 'first' : 'last'}-${Date.now()}`;
    const target = `Target-${prefix}`;
    const renamed = `${prefix} renamed`;
    const tracked = 60000;
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(prefix);
      await waitForTask(clientA.page, prefix);
      await createProjectReliably(clientA.page, target);
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, prefix);

      const start = await onTask(clientA, prefix);
      expect(start.listedIn).toEqual([start.project]);
      expect(await onTask(clientB, prefix)).toEqual(start);

      for (const client of clients) {
        await blockBackgroundSync(client);
      }

      const moving = mover === 'A' ? clientA : clientB;
      const editing = mover === 'A' ? clientB : clientA;
      const move = (): Promise<TaskView> => onTask(moving, prefix, { moveTo: target });
      const edit = async (): Promise<void> => {
        if (other === 'rename') {
          await onTask(editing, prefix, { rename: renamed });
        } else {
          await recordTaskTimeDelta(editing, prefix, '2026-07-13', tracked);
        }
      };
      // Ops are stamped in milliseconds: keep the two changes apart.
      const gap = (): Promise<void> => clientA.page.waitForTimeout(50);
      if (moveFirst) {
        await move();
        await gap();
        await edit();
      } else {
        await edit();
        await gap();
        await move();
      }
      expect(await onTask(moving, prefix)).toEqual({
        ...start,
        project: target,
        listedIn: [target],
      });

      await sync(clientA);
      await sync(clientB);
      await sync(clientA);
      await sync(clientB);

      const expected: TaskView = {
        title: other === 'rename' ? renamed : start.title,
        project: target,
        listedIn: [target],
        timeSpent: other === 'time' ? tracked : 0,
      };
      const expectConverged = async (): Promise<void> => {
        // Both devices in one assertion, so a failure shows the divergence.
        await expect
          .poll(
            async () => ({
              A: await onTask(clientA, prefix),
              B: await onTask(clientB, prefix),
            }),
            { timeout: 30000 },
          )
          .toEqual({ A: expected, B: expected });
      };
      await expectConverged();

      // A restart replays each device's own log.
      for (const client of clients) {
        await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(client.page);
      }
      await expectConverged();
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  };

  for (const other of ['rename', 'time'] as const) {
    for (const mover of ['A', 'B'] as const) {
      for (const moveFirst of [true, false]) {
        const what = other === 'rename' ? 'a rename' : 'tracked time';
        const order = moveFirst ? 'made before it' : 'made after it';
        const side = mover === 'B' ? 'the resolving device' : 'the other device';
        test(`${what} keeps a move ${order} on ${side}`, async ({
          browser,
          baseURL,
          testRunId,
        }) => {
          test.setTimeout(240000);
          await runCrossing({ browser, baseURL, testRunId }, other, mover, moveFirst);
        });
      }
    }
  }
});
