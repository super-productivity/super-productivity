import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  createProjectReliably,
  waitForTask,
  deleteTask,
  getLocalOpLogSummary,
  recordTaskTimeDelta,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #11685. Reproduces the sync fuzz `move` mix's two-step traces in the app
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

/**
 * The ids a project lists (task list or backlog) that are no task: the app
 * reports "Missing task data for project" for one, repairs the dataset and
 * uploads a full-state REPAIR.
 */
const danglingProjectTaskIds = async (client: SimulatedE2EClient): Promise<string[]> =>
  client.page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        type Subscription = { unsubscribe: () => void };
        type Slice = { entities?: Record<string, Record<string, unknown> | undefined> };
        const store = (
          window as unknown as {
            __e2eTestHelpers?: {
              store?: { subscribe: (next: (state: unknown) => void) => Subscription };
            };
          }
        ).__e2eTestHelpers?.store;
        if (!store) {
          reject(new Error('E2E store helper is unavailable'));
          return;
        }
        const ref: { current?: Subscription } = {};
        ref.current = store.subscribe((state) => {
          window.setTimeout(() => ref.current?.unsubscribe());
          const root = state as Record<string, Slice | undefined>;
          const tasks = (root.tasks ?? root.task)?.entities ?? {};
          const projects = Object.values((root.projects ?? root.project)?.entities ?? {});
          resolve(
            projects.flatMap((project) =>
              [
                ...((project?.taskIds as string[] | undefined) ?? []),
                ...((project?.backlogTaskIds as string[] | undefined) ?? []),
              ].filter((id) => !tasks[id]),
            ),
          );
        });
      }),
  );

test.describe('@supersync a task deleted after its move travelled as a field row', () => {
  /**
   * B edits the task's notes, A moves it later and resolves the conflict, so
   * the move reaches B as a `projectId` row (#11685). B then deletes the task.
   * A device that replays the row and the delete in one batch (a new device,
   * or B after a restart) skips the row of the deleted task, and the delete
   * used to clear only the project its payload named: the dead id stayed in
   * the project the task had left.
   */
  test('leaves no dead task id in a project list on any device', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    const prefix = `MoveThenDelete-${Date.now()}`;
    const target = `Target-${prefix}`;
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
      for (const client of clients) {
        await blockBackgroundSync(client);
      }

      await onTask(clientB, prefix, { rename: `${prefix} renamed` });
      await clientA.page.waitForTimeout(50);
      await onTask(clientA, prefix, { moveTo: target });
      await sync(clientB);
      await sync(clientA);
      await sync(clientB);
      await expect
        .poll(async () => (await onTask(clientB, prefix)).listedIn, { timeout: 30000 })
        .toEqual([target]);

      // B deletes the task where it now lives, then uploads the delete.
      await clientB.page.goto('/#/tag/TODAY/work');
      await waitForTask(clientB.page, prefix);
      await blockBackgroundSync(clientB);
      await deleteTask(clientB, prefix);
      await sync(clientB);
      await sync(clientA);

      // A new device replays the whole history in one download.
      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      // B replays its own log on a restart.
      await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForAppReady(clientB.page);

      await expect
        .poll(
          async () => ({
            A: await danglingProjectTaskIds(clientA),
            B: await danglingProjectTaskIds(clientB),
            C: await danglingProjectTaskIds(clientC),
          }),
          { timeout: 30000 },
        )
        .toEqual({ A: [], B: [], C: [] });
      // An auto-repair would have cleaned the lists: no device may hold one.
      for (const client of clients) {
        const repairs = (await getLocalOpLogSummary(client.page)).filter(
          ({ opType }) => opType === 'REPAIR',
        );
        expect(repairs, `REPAIR ops on ${client.clientName}`).toEqual([]);
      }
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });
});
