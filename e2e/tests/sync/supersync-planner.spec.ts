import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

type PlannerTaskSnapshot = {
  id: string;
  title: string;
  dueDay: string | null;
  tagIds: string[];
};

type PlannerSyncSnapshot = {
  tasks: PlannerTaskSnapshot[];
  plannerTaskIds: string[];
  todayTaskIds: string[];
};

const getDbDateStr = async (page: Page, offsetDays = 0): Promise<string> =>
  page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }, offsetDays);

const getPlannerSyncSnapshot = async (
  page: Page,
  taskNames: string[],
  plannerDay: string,
): Promise<PlannerSyncSnapshot> =>
  page.evaluate(
    ({ names, day }) => {
      type TaskLike = {
        id?: string;
        title?: string;
        dueDay?: string | null;
        tagIds?: string[];
      };
      type TagLike = { taskIds?: string[] };
      type StoreState = {
        tasks?: { entities?: Record<string, TaskLike | undefined> };
        tag?: { entities?: Record<string, TagLike | undefined> };
        planner?: { days?: Record<string, string[] | undefined> };
      };
      type StoreSubscription = { unsubscribe: () => void };
      type StoreLike = {
        subscribe: (next: (state: StoreState) => void) => StoreSubscription;
      };

      const store = (
        window as unknown as {
          __e2eTestHelpers?: { store?: StoreLike };
        }
      ).__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }

      let latestState: StoreState | undefined;
      const subscription = store.subscribe((state) => {
        latestState = state;
      });
      subscription.unsubscribe();

      const tasks: PlannerTaskSnapshot[] = [];
      for (const task of Object.values(latestState?.tasks?.entities ?? {})) {
        if (task?.id && task.title && names.some((name) => task.title?.includes(name))) {
          tasks.push({
            id: task.id,
            title: task.title,
            dueDay: task.dueDay ?? null,
            tagIds: [...(task.tagIds ?? [])],
          });
        }
      }

      return {
        tasks,
        plannerTaskIds: [...(latestState?.planner?.days?.[day] ?? [])],
        todayTaskIds: [...(latestState?.tag?.entities?.TODAY?.taskIds ?? [])],
      };
    },
    { names: taskNames, day: plannerDay },
  );

const getTask = (
  snapshot: PlannerSyncSnapshot,
  taskName: string,
): PlannerTaskSnapshot => {
  const task = snapshot.tasks.find((candidate) => candidate.title.includes(taskName));
  expect(task, `Task state missing for ${taskName}`).toBeDefined();
  return task!;
};

const getMatchingOrder = (allTaskIds: string[], taskIds: string[]): string[] => {
  const taskIdSet = new Set(taskIds);
  return allTaskIds.filter((taskId) => taskIdSet.has(taskId));
};

test.describe('@supersync Planner Sync', () => {
  test('Tomorrow short syntax syncs dueDay and planner order', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskNames = [`TomorrowFirst-${uniqueId}`, `TomorrowSecond-${uniqueId}`];
      const tomorrow = await getDbDateStr(clientA.page, 1);

      for (const taskName of taskNames) {
        await clientA.workView.addTask(`${taskName} @tomorrow`, false, null);
        await expect
          .poll(async () => {
            const snapshot = await getPlannerSyncSnapshot(
              clientA!.page,
              taskNames,
              tomorrow,
            );
            return snapshot.tasks.find((task) => task.title.includes(taskName))?.dueDay;
          })
          .toBe(tomorrow);
      }

      const clientAState = await getPlannerSyncSnapshot(
        clientA.page,
        taskNames,
        tomorrow,
      );
      expect(clientAState.tasks).toHaveLength(taskNames.length);
      const taskIds = taskNames.map((taskName) => getTask(clientAState, taskName).id);
      expect(getMatchingOrder(clientAState.plannerTaskIds, taskIds)).toEqual([
        taskIds[1],
        taskIds[0],
      ]);
      expect(getMatchingOrder(clientAState.todayTaskIds, taskIds)).toEqual([]);

      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await expect
        .poll(async () => {
          const snapshot = await getPlannerSyncSnapshot(
            clientB!.page,
            taskNames,
            tomorrow,
          );
          return taskNames.map(
            (taskName) =>
              snapshot.tasks.find((task) => task.title.includes(taskName))?.dueDay,
          );
        })
        .toEqual([tomorrow, tomorrow]);

      const clientBState = await getPlannerSyncSnapshot(
        clientB.page,
        taskNames,
        tomorrow,
      );
      expect(clientBState.tasks).toHaveLength(taskNames.length);
      expect(clientBState.tasks.map((task) => task.id).sort()).toEqual(
        [...taskIds].sort(),
      );
      expect(getMatchingOrder(clientBState.plannerTaskIds, taskIds)).toEqual([
        taskIds[1],
        taskIds[0],
      ]);

      await clientB.page.goto('/#/planner');
      const tomorrowDay = clientB.page.locator(`planner-day[data-day="${tomorrow}"]`);
      for (const taskName of taskNames) {
        await expect(
          tomorrowDay.locator('planner-task').filter({ hasText: taskName }),
        ).toBeVisible();
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Today short syntax syncs virtual TODAY membership and order', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskNames = [`TodayFirst-${uniqueId}`, `TodaySecond-${uniqueId}`];
      const today = await getDbDateStr(clientA.page);
      for (const taskName of taskNames) {
        await clientA.workView.addTask(`${taskName} @today`, false, taskName);
      }

      const clientAState = await getPlannerSyncSnapshot(clientA.page, taskNames, today);
      expect(clientAState.tasks).toHaveLength(taskNames.length);
      const taskIds = taskNames.map((taskName) => getTask(clientAState, taskName).id);
      for (const taskName of taskNames) {
        const task = getTask(clientAState, taskName);
        expect(task.dueDay).toBe(today);
        expect(task.tagIds).not.toContain('TODAY');
      }
      expect(getMatchingOrder(clientAState.todayTaskIds, taskIds)).toEqual([
        taskIds[1],
        taskIds[0],
      ]);
      expect(getMatchingOrder(clientAState.plannerTaskIds, taskIds)).toEqual([]);

      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
      }

      const clientBState = await getPlannerSyncSnapshot(clientB.page, taskNames, today);
      expect(clientBState.tasks).toHaveLength(taskNames.length);
      expect(clientBState.tasks.map((task) => task.id).sort()).toEqual(
        [...taskIds].sort(),
      );
      for (const taskName of taskNames) {
        const task = getTask(clientBState, taskName);
        expect(task.dueDay).toBe(today);
        expect(task.tagIds).not.toContain('TODAY');
      }
      expect(getMatchingOrder(clientBState.todayTaskIds, taskIds)).toEqual([
        taskIds[1],
        taskIds[0],
      ]);
      expect(getMatchingOrder(clientBState.plannerTaskIds, taskIds)).toEqual([]);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
