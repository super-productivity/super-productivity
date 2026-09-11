import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

interface TaskRecord extends Record<string, unknown> {
  id: string;
  title: string;
  dueDay?: string;
}

interface PlannerSnapshot {
  plannerTaskIds: string[];
  todayTaskIds: string[];
  winner: { title: string; dueDay?: string };
  remoteWinner: { title: string; dueDay?: string };
}

interface PersistentAction extends Record<string, unknown> {
  type: string;
  meta: Record<string, unknown>;
}

const dispatchPersistentAction = async (
  page: Page,
  action: PersistentAction,
): Promise<void> => {
  const dispatched = await page.evaluate((actionToDispatch) => {
    type StoreLike = { dispatch: (value: unknown) => void };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) return false;
    store.dispatch(actionToDispatch);
    return true;
  }, action);
  expect(dispatched).toBe(true);
};

const getTasksByTitle = async (
  page: Page,
  titles: string[],
): Promise<Record<string, TaskRecord>> =>
  page.evaluate((requestedTitles) => {
    type StoreState = {
      tasks?: { entities?: Record<string, TaskRecord | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');

    let state: StoreState | undefined;
    const subscription = store.subscribe((value) => {
      state = value;
    });
    subscription.unsubscribe();

    const tasks = Object.values(state?.tasks?.entities ?? {});
    return Object.fromEntries(
      requestedTitles.map((title) => {
        const task = tasks.find((candidate) => candidate?.title === title);
        if (!task) throw new Error(`Task "${title}" was not found in the store`);
        return [title, task];
      }),
    );
  }, titles);

const getPlannerSnapshot = async (
  page: Page,
  day: string,
  winnerId: string,
  remoteWinnerId: string,
): Promise<PlannerSnapshot> =>
  page.evaluate(
    ({ plannerDay, localId, remoteId }) => {
      type TaskLike = { title: string; dueDay?: string };
      type StoreState = {
        tasks?: { entities?: Record<string, TaskLike | undefined> };
        planner?: { days?: Record<string, string[]> };
        tag?: { entities?: Record<string, { taskIds?: string[] } | undefined> };
      };
      type StoreLike = {
        subscribe: (next: (state: StoreState) => void) => {
          unsubscribe: () => void;
        };
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) throw new Error('__e2eTestHelpers.store missing');

      let state: StoreState | undefined;
      const subscription = store.subscribe((value) => {
        state = value;
      });
      subscription.unsubscribe();

      const winner = state?.tasks?.entities?.[localId];
      const remoteWinner = state?.tasks?.entities?.[remoteId];
      if (!winner || !remoteWinner) throw new Error('Expected task state is missing');
      return {
        plannerTaskIds: state?.planner?.days?.[plannerDay] ?? [],
        todayTaskIds: state?.tag?.entities?.TODAY?.taskIds ?? [],
        winner: { title: winner.title, dueDay: winner.dueDay },
        remoteWinner: {
          title: remoteWinner.title,
          dueDay: remoteWinner.dueDay,
        },
      };
    },
    { plannerDay: day, localId: winnerId, remoteId: remoteWinnerId },
  );

test.describe('@supersync Today-plan mixed-winner convergence', () => {
  test.describe.configure({ mode: 'serial' });

  test('keeps the local winner in its future planner position across replay and a fresh client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    const today = '2026-08-04';
    const futureDay = '2026-08-08';
    const seedTime = new Date('2026-08-04T08:00:00');
    const remotePlanTime = new Date('2026-08-04T09:00:00');
    const localEditTime = new Date('2026-08-04T09:01:00');
    const untouchedTitle = `A-${testRunId}-Untouched`;
    const winnerTitle = `A-${testRunId}-Local winner`;
    const renamedWinnerTitle = `${winnerTitle} renamed`;
    const remoteWinnerTitle = `A-${testRunId}-Remote winner`;
    const concurrentTitle = `B-${testRunId}-Concurrent placement`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.page.clock.setFixedTime(seedTime);
      await clientA.page.reload();
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);

      await clientA.workView.addTask('Untouched');
      await clientA.workView.addTask('Local winner');
      await clientA.workView.addTask('Remote winner');
      const tasks = await getTasksByTitle(clientA.page, [
        untouchedTitle,
        winnerTitle,
        remoteWinnerTitle,
      ]);
      for (const title of [untouchedTitle, winnerTitle, remoteWinnerTitle]) {
        const task = tasks[title];
        await dispatchPersistentAction(clientA.page, {
          type: '[Planner] Plan Task for Day',
          task,
          day: futureDay,
          meta: {
            isPersistent: true,
            entityType: 'PLANNER',
            entityId: task.id,
            opType: 'UPD',
          },
        });
      }

      const untouchedId = tasks[untouchedTitle].id;
      const winnerId = tasks[winnerTitle].id;
      const remoteWinnerId = tasks[remoteWinnerTitle].id;
      const seededPlannerIds = [untouchedId, winnerId, remoteWinnerId];
      await expect
        .poll(
          async () =>
            (await getPlannerSnapshot(clientA!.page, futureDay, winnerId, remoteWinnerId))
              .plannerTaskIds,
        )
        .toEqual(seededPlannerIds);

      await clientA.sync.syncAndWait();
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.page.clock.setFixedTime(seedTime);
      await clientB.page.reload();
      await clientB.workView.waitForTaskList();
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await clientB.page.clock.setFixedTime(remotePlanTime);
      await dispatchPersistentAction(clientB.page, {
        type: '[Task Shared] planTasksForToday',
        taskIds: [winnerId, remoteWinnerId],
        today,
        startOfNextDayDiffMs: 0,
        parentTaskMap: {},
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityIds: [winnerId, remoteWinnerId],
          opType: 'UPD',
          isBulk: true,
        },
      });
      await expect
        .poll(
          async () =>
            (await getPlannerSnapshot(clientB!.page, futureDay, winnerId, remoteWinnerId))
              .plannerTaskIds,
        )
        .toEqual([untouchedId]);

      await clientB.workView.addTask('Concurrent placement');
      const concurrentTask = (await getTasksByTitle(clientB.page, [concurrentTitle]))[
        concurrentTitle
      ];
      await dispatchPersistentAction(clientB.page, {
        type: '[Planner] Plan Task for Day',
        task: concurrentTask,
        day: futureDay,
        meta: {
          isPersistent: true,
          entityType: 'PLANNER',
          entityId: concurrentTask.id,
          opType: 'UPD',
        },
      });
      await expect
        .poll(
          async () =>
            (await getPlannerSnapshot(clientB!.page, futureDay, winnerId, remoteWinnerId))
              .plannerTaskIds,
        )
        .toEqual([untouchedId, concurrentTask.id]);

      await clientA.page.clock.setFixedTime(localEditTime);
      await dispatchPersistentAction(clientA.page, {
        type: '[Task Shared] updateTask',
        task: { id: winnerId, changes: { title: renamedWinnerTitle } },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: winnerId,
          opType: 'UPD',
        },
      });
      await expect
        .poll(
          async () =>
            (await getPlannerSnapshot(clientA!.page, futureDay, winnerId, remoteWinnerId))
              .winner.title,
        )
        .toBe(renamedWinnerTitle);

      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      const expectedSnapshot: PlannerSnapshot = {
        plannerTaskIds: [untouchedId, winnerId, concurrentTask.id],
        todayTaskIds: [remoteWinnerId],
        winner: { title: renamedWinnerTitle, dueDay: futureDay },
        remoteWinner: { title: remoteWinnerTitle, dueDay: today },
      };
      expect(
        await getPlannerSnapshot(clientA.page, futureDay, winnerId, remoteWinnerId),
      ).toEqual(expectedSnapshot);
      expect(
        await getPlannerSnapshot(clientB.page, futureDay, winnerId, remoteWinnerId),
      ).toEqual(expectedSnapshot);

      await clientA.page.reload();
      await clientA.workView.waitForTaskList();
      await clientB.page.reload();
      await clientB.workView.waitForTaskList();
      expect(
        await getPlannerSnapshot(clientA.page, futureDay, winnerId, remoteWinnerId),
      ).toEqual(expectedSnapshot);
      expect(
        await getPlannerSnapshot(clientB.page, futureDay, winnerId, remoteWinnerId),
      ).toEqual(expectedSnapshot);

      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.page.clock.setFixedTime(localEditTime);
      await clientC.page.reload();
      await clientC.workView.waitForTaskList();
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      expect(
        await getPlannerSnapshot(clientC.page, futureDay, winnerId, remoteWinnerId),
      ).toEqual(expectedSnapshot);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
