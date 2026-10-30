import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  deleteTask,
  getSuperSyncConfig,
  getTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * "Move to bottom" on a task in a section, while another client deletes the
 * section's last task, must leave both clients with the same section order.
 *
 * An anchor-based move ("after the current last task") is a no-op on the
 * client where that anchor is already gone, so the two clients kept different
 * orders until the section was reordered again. The work-context move
 * (moveTaskToBottomInTodayList) puts the task at the end on every client.
 */

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
};

const getSectionTitles = async (page: Page, sectionId: string): Promise<string[]> =>
  page.evaluate((id) => {
    type TaskLike = { id: string; title: string };
    type State = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      section?: { entities?: Record<string, { taskIds: string[] } | undefined> };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: State = {};
    store.subscribe((value) => (state = value as State)).unsubscribe();
    const tasks = state.tasks?.entities ?? {};
    return (state.section?.entities?.[id]?.taskIds ?? []).map(
      (taskId) => tasks[taskId]?.title ?? `[missing:${taskId}]`,
    );
  }, sectionId);

/** Creates a TODAY section holding the given tasks, in that order. */
const seedTodaySection = async (
  page: Page,
  sectionId: string,
  titles: string[],
): Promise<void> => {
  const isSeeded = await page.evaluate(
    ({ id, taskTitles }) => {
      type TaskLike = { id: string; title: string };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) return false;
      let state: { tasks?: { entities?: Record<string, TaskLike | undefined> } } = {};
      store.subscribe((value) => (state = value as typeof state)).unsubscribe();
      const tasks = Object.values(state.tasks?.entities ?? {});
      const taskIds = taskTitles.map(
        (title) => tasks.find((task) => task?.title === title)?.id,
      );
      if (taskIds.some((taskId) => !taskId)) return false;

      store.dispatch({
        type: '[Section] Add Section',
        section: {
          id,
          contextId: 'TODAY',
          contextType: 'TAG',
          title: 'Box',
          isExpanded: true,
          taskIds: [],
        },
        meta: { isPersistent: true, entityType: 'SECTION', entityId: id, opType: 'CRT' },
      });
      taskIds.forEach((taskId, i) =>
        store.dispatch({
          type: '[Section] Add Task to Section',
          sectionId: id,
          taskId,
          afterTaskId: i ? taskIds[i - 1] : null,
          sourceSectionId: null,
          meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: id,
            opType: 'MOV',
          },
        }),
      );
      return true;
    },
    { id: sectionId, taskTitles: titles },
  );
  expect(isSeeded).toBe(true);
};

test.describe('@supersync Section move to bottom beside a concurrent delete', () => {
  test('converges when the last task of the section is deleted concurrently', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    const sectionId = `section-box-${testRunId}`;
    const moverTitle = `A-${testRunId}-Mover`;
    const middleTitle = `A-${testRunId}-Middle`;
    const anchorTitle = `A-${testRunId}-Anchor`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask('Mover');
      await clientA.workView.addTask('Middle');
      await clientA.workView.addTask('Anchor');
      await seedTodaySection(clientA.page, sectionId, [
        moverTitle,
        middleTitle,
        anchorTitle,
      ]);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.workView.waitForTaskList();
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      const seeded = [moverTitle, middleTitle, anchorTitle];
      expect(await getSectionTitles(clientA.page, sectionId)).toEqual(seeded);
      expect(await getSectionTitles(clientB.page, sectionId)).toEqual(seeded);

      // Client A: move "Mover" to the bottom of the rendered section.
      const mover = getTaskElement(clientA, moverTitle);
      await mover.focus();
      await expect(mover).toBeFocused();
      await clientA.page.keyboard.press('Control+Alt+ArrowDown');
      await expect
        .poll(() => getSectionTitles(clientA!.page, sectionId))
        .toEqual([middleTitle, anchorTitle, moverTitle]);

      // Client B, concurrently: delete the section's last task.
      await deleteTask(clientB, anchorTitle);
      await expect
        .poll(() => getSectionTitles(clientB!.page, sectionId))
        .toEqual([moverTitle, middleTitle]);

      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      const converged = [middleTitle, moverTitle];
      expect({
        clientA: await getSectionTitles(clientA.page, sectionId),
        clientB: await getSectionTitles(clientB.page, sectionId),
      }).toEqual({ clientA: converged, clientB: converged });

      await clientB.page.reload();
      await clientB.workView.waitForTaskList();
      expect(await getSectionTitles(clientB.page, sectionId)).toEqual(converged);

      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.workView.waitForTaskList();
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      expect(await getSectionTitles(clientC.page, sectionId)).toEqual(converged);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
