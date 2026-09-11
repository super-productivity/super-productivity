import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

interface SectionSnapshot {
  leftTitles: string[];
  rightTitles: string[];
  thirdTitles: string[];
  noSectionTitles: string[];
  todayTitles: string[];
  todaySectionIds: string[];
  movingSectionMemberships: number;
  movingTodayOccurrences: number;
  placementSectionMemberships: number;
  placementTodayOccurrences: number;
}

interface PersistentAction extends Record<string, unknown> {
  type: string;
  meta: Record<string, unknown>;
}

const dispatchPersistentAction = async (
  page: Page,
  action: PersistentAction,
): Promise<void> => {
  const wasDispatched = await page.evaluate((actionToDispatch) => {
    type StoreLike = { dispatch: (action: unknown) => void };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) return false;
    store.dispatch(actionToDispatch);
    return true;
  }, action);

  expect(wasDispatched).toBe(true);
};

const getTaskIdsByTitle = async (
  page: Page,
  titles: string[],
): Promise<Record<string, string | null>> =>
  page.evaluate((taskTitles) => {
    type TaskLike = { id: string; title: string };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let state: StoreState | undefined;
    const subscription = store.subscribe((value) => {
      state = value;
    });
    subscription.unsubscribe();

    const tasks = Object.values(state?.tasks?.entities ?? {});
    return Object.fromEntries(
      taskTitles.map((title) => [
        title,
        tasks.find((task) => task?.title === title)?.id ?? null,
      ]),
    );
  }, titles);

const requireTaskId = (
  taskIdsByTitle: Record<string, string | null>,
  title: string,
): string => {
  const id = taskIdsByTitle[title];
  if (!id) throw new Error(`Task "${title}" was not found in the store`);
  return id;
};

const getSectionSnapshot = async (
  page: Page,
  leftSectionId: string,
  rightSectionId: string,
  thirdSectionId: string,
  movingTaskId: string,
  placementTaskId: string,
): Promise<SectionSnapshot> =>
  page.evaluate(
    ({ leftId, rightId, thirdId, movingId, placementId }) => {
      type TaskLike = { id: string; title: string };
      type SectionLike = { id: string; contextId: string; taskIds: string[] };
      type TagLike = { taskIds: string[] };
      type StoreState = {
        tasks?: { entities?: Record<string, TaskLike | undefined> };
        section?: {
          ids?: Array<string | number>;
          entities?: Record<string, SectionLike | undefined>;
        };
        tag?: { entities?: Record<string, TagLike | undefined> };
      };
      type StoreLike = {
        subscribe: (next: (state: StoreState) => void) => {
          unsubscribe: () => void;
        };
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing');
      }

      let state: StoreState | undefined;
      const subscription = store.subscribe((value) => {
        state = value;
      });
      subscription.unsubscribe();

      const tasks = state?.tasks?.entities ?? {};
      const sections = state?.section?.entities ?? {};
      const todayTaskIds = state?.tag?.entities?.TODAY?.taskIds ?? [];
      const todaySections = Object.values(sections).filter(
        (section): section is SectionLike => section?.contextId === 'TODAY',
      );
      const todaySectionIds = (state?.section?.ids ?? [])
        .map(String)
        .filter((id) => sections[id]?.contextId === 'TODAY');
      const sectionedTaskIds = new Set(
        todaySections.flatMap((section) => section.taskIds),
      );
      const titlesFor = (ids: string[]): string[] =>
        ids.map((id) => tasks[id]?.title ?? `[missing:${id}]`);

      return {
        leftTitles: titlesFor(sections[leftId]?.taskIds ?? []),
        rightTitles: titlesFor(sections[rightId]?.taskIds ?? []),
        thirdTitles: titlesFor(sections[thirdId]?.taskIds ?? []),
        noSectionTitles: titlesFor(
          todayTaskIds.filter((id) => !sectionedTaskIds.has(id)),
        ),
        todayTitles: titlesFor(todayTaskIds),
        todaySectionIds,
        movingSectionMemberships: todaySections.filter((section) =>
          section.taskIds.includes(movingId),
        ).length,
        movingTodayOccurrences: todayTaskIds.filter((id) => id === movingId).length,
        placementSectionMemberships: todaySections.filter((section) =>
          section.taskIds.includes(placementId),
        ).length,
        placementTodayOccurrences: todayTaskIds.filter((id) => id === placementId).length,
      };
    },
    {
      leftId: leftSectionId,
      rightId: rightSectionId,
      thirdId: thirdSectionId,
      movingId: movingTaskId,
      placementId: placementTaskId,
    },
  );

test.describe('@supersync Section cross-client convergence', () => {
  test('concurrent move, removal, reorder, and dependent placements converge and persist', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    const leftSectionId = `section-left-${testRunId}`;
    const rightSectionId = `section-right-${testRunId}`;
    const thirdSectionId = `section-third-${testRunId}`;
    const movingTitle = `A-${testRunId}-Moving`;
    const placementTitle = `A-${testRunId}-Placement C`;
    const placementBTitle = `A-${testRunId}-Placement B`;
    const placementATitle = `A-${testRunId}-Placement A`;
    const leftAnchorTitle = `A-${testRunId}-Left anchor`;
    const rightAnchorTitle = `A-${testRunId}-Right anchor`;
    const mainAnchorTitle = `A-${testRunId}-Main anchor`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);

      await clientA.workView.addTask('Main anchor');
      await clientA.workView.addTask('Left anchor');
      await clientA.workView.addTask('Moving');
      await clientA.workView.addTask('Right anchor');
      await clientA.workView.addTask('Placement C');
      await clientA.workView.addTask('Placement B');
      await clientA.workView.addTask('Placement A');

      const taskIdsByTitle = await getTaskIdsByTitle(clientA.page, [
        mainAnchorTitle,
        leftAnchorTitle,
        movingTitle,
        rightAnchorTitle,
        placementTitle,
        placementBTitle,
        placementATitle,
      ]);
      const mainAnchorId = requireTaskId(taskIdsByTitle, mainAnchorTitle);
      const leftAnchorId = requireTaskId(taskIdsByTitle, leftAnchorTitle);
      const movingTaskId = requireTaskId(taskIdsByTitle, movingTitle);
      const rightAnchorId = requireTaskId(taskIdsByTitle, rightAnchorTitle);
      const placementTaskId = requireTaskId(taskIdsByTitle, placementTitle);
      const placementBTaskId = requireTaskId(taskIdsByTitle, placementBTitle);
      const placementATaskId = requireTaskId(taskIdsByTitle, placementATitle);

      for (const [id, title] of [
        [leftSectionId, 'Left'],
        [rightSectionId, 'Right'],
        [thirdSectionId, 'Third'],
      ]) {
        await dispatchPersistentAction(clientA.page, {
          type: '[Section] Add Section',
          section: {
            id,
            contextId: 'TODAY',
            contextType: 'TAG',
            title,
            isExpanded: true,
            taskIds: [],
          },
          meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: id,
            opType: 'CRT',
          },
        });
      }

      for (const [sectionId, taskId, afterTaskId] of [
        [leftSectionId, leftAnchorId, null],
        [leftSectionId, movingTaskId, leftAnchorId],
        [rightSectionId, rightAnchorId, null],
      ]) {
        await dispatchPersistentAction(clientA.page, {
          type: '[Section] Add Task to Section',
          sectionId,
          taskId,
          afterTaskId,
          sourceSectionId: null,
          meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: sectionId,
            opType: 'MOV',
          },
        });
      }

      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.workView.waitForTaskList();
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      const seededSnapshot: SectionSnapshot = {
        leftTitles: [leftAnchorTitle, movingTitle],
        rightTitles: [rightAnchorTitle],
        thirdTitles: [],
        noSectionTitles: [
          placementATitle,
          placementBTitle,
          placementTitle,
          mainAnchorTitle,
        ],
        todayTitles: [
          placementATitle,
          placementBTitle,
          placementTitle,
          rightAnchorTitle,
          movingTitle,
          leftAnchorTitle,
          mainAnchorTitle,
        ],
        todaySectionIds: [leftSectionId, rightSectionId, thirdSectionId],
        movingSectionMemberships: 1,
        movingTodayOccurrences: 1,
        placementSectionMemberships: 0,
        placementTodayOccurrences: 1,
      };
      expect(
        await getSectionSnapshot(
          clientA.page,
          leftSectionId,
          rightSectionId,
          thirdSectionId,
          movingTaskId,
          placementTaskId,
        ),
      ).toEqual(seededSnapshot);
      expect(
        await getSectionSnapshot(
          clientB.page,
          leftSectionId,
          rightSectionId,
          thirdSectionId,
          movingTaskId,
          placementTaskId,
        ),
      ).toEqual(seededSnapshot);

      await dispatchPersistentAction(clientA.page, {
        type: '[Section] Add Task to Section',
        sectionId: rightSectionId,
        taskId: movingTaskId,
        afterTaskId: rightAnchorId,
        sourceSectionId: leftSectionId,
        meta: {
          isPersistent: true,
          entityType: 'SECTION',
          entityIds: [leftSectionId, rightSectionId],
          opType: 'MOV',
        },
      });
      for (const taskId of [placementTaskId, placementBTaskId, placementATaskId]) {
        await dispatchPersistentAction(clientA.page, {
          type: '[Section] Add Task to Section',
          sectionId: thirdSectionId,
          taskId,
          afterTaskId: null,
          sourceSectionId: null,
          meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: thirdSectionId,
            opType: 'MOV',
          },
        });
      }

      await dispatchPersistentAction(clientB.page, {
        type: '[Section] Remove Task from Section',
        sectionId: leftSectionId,
        taskId: movingTaskId,
        workContextId: 'TODAY',
        workContextType: 'TAG',
        workContextAfterTaskId: mainAnchorId,
        meta: {
          isPersistent: true,
          entityType: 'SECTION',
          entityId: leftSectionId,
          opType: 'UPD',
        },
      });
      await dispatchPersistentAction(clientB.page, {
        type: '[Section] Update Section Order',
        contextId: 'TODAY',
        ids: [rightSectionId, thirdSectionId, leftSectionId],
        meta: {
          isPersistent: true,
          entityType: 'SECTION',
          entityIds: [rightSectionId, thirdSectionId, leftSectionId],
          opType: 'MOV',
          isBulk: true,
        },
      });

      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      const convergedSnapshot: SectionSnapshot = {
        leftTitles: [leftAnchorTitle],
        rightTitles: [rightAnchorTitle, movingTitle],
        thirdTitles: [placementATitle, placementBTitle, placementTitle],
        noSectionTitles: [mainAnchorTitle],
        todayTitles: [
          placementATitle,
          placementBTitle,
          placementTitle,
          rightAnchorTitle,
          leftAnchorTitle,
          mainAnchorTitle,
          movingTitle,
        ],
        todaySectionIds: [rightSectionId, thirdSectionId, leftSectionId],
        movingSectionMemberships: 1,
        movingTodayOccurrences: 1,
        placementSectionMemberships: 1,
        placementTodayOccurrences: 1,
      };
      const convergedClientASnapshot = await getSectionSnapshot(
        clientA.page,
        leftSectionId,
        rightSectionId,
        thirdSectionId,
        movingTaskId,
        placementTaskId,
      );
      const convergedClientBSnapshot = await getSectionSnapshot(
        clientB.page,
        leftSectionId,
        rightSectionId,
        thirdSectionId,
        movingTaskId,
        placementTaskId,
      );
      expect({
        clientA: convergedClientASnapshot,
        clientB: convergedClientBSnapshot,
      }).toEqual({
        clientA: convergedSnapshot,
        clientB: convergedSnapshot,
      });
      await expect(
        clientA.page.locator('task').filter({ hasText: movingTitle }),
      ).toHaveCount(1);
      await expect(
        clientB.page.locator('task').filter({ hasText: movingTitle }),
      ).toHaveCount(1);

      await clientA.page.reload();
      await clientA.workView.waitForTaskList();
      await clientB.page.reload();
      await clientB.workView.waitForTaskList();
      expect(
        await getSectionSnapshot(
          clientA.page,
          leftSectionId,
          rightSectionId,
          thirdSectionId,
          movingTaskId,
          placementTaskId,
        ),
      ).toEqual(convergedSnapshot);
      expect(
        await getSectionSnapshot(
          clientB.page,
          leftSectionId,
          rightSectionId,
          thirdSectionId,
          movingTaskId,
          placementTaskId,
        ),
      ).toEqual(convergedSnapshot);

      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.workView.waitForTaskList();
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      expect(
        await getSectionSnapshot(
          clientC.page,
          leftSectionId,
          rightSectionId,
          thirdSectionId,
          movingTaskId,
          placementTaskId,
        ),
      ).toEqual(convergedSnapshot);
      await expect(
        clientC.page.locator('task').filter({ hasText: movingTitle }),
      ).toHaveCount(1);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
