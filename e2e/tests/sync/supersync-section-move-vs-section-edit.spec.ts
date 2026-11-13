import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * #10969: a cross-section task move (`addTaskToSection` with a different
 * `sourceSectionId`) declares both sections. A concurrent collapse or rename of
 * either section used to stop sync with the whole-dataset "Keep local / Keep
 * remote" dialog. The move writes only `taskIds` and the edit only `isExpanded`
 * or `title`, so both must apply on every device in either sync order.
 *
 * The same holds for a concurrent drag of a different task into, within or out
 * of either section: each op writes only its own task's membership, and the
 * device whose upload the server rejects reissues it from the merged state.
 *
 * Actions are dispatched as the UI dispatches them (drag → addTaskToSection or
 * removeTaskFromSection, section header → updateSection). syncAndWait() fails
 * on the conflict dialog.
 */

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
};

interface SectionView {
  title: string;
  isExpanded: boolean | undefined;
  tasks: string[];
}

const readSections = async (
  page: Page,
  sectionIds: string[],
): Promise<Record<string, SectionView | null>> =>
  page.evaluate((ids) => {
    type TaskLike = { id: string; title: string };
    type SectionLike = { title: string; isExpanded?: boolean; taskIds: string[] };
    type State = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      section?: { entities?: Record<string, SectionLike | undefined> };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: State = {};
    store.subscribe((value) => (state = value as State)).unsubscribe();
    const tasks = state.tasks?.entities ?? {};
    return Object.fromEntries(
      ids.map((id) => {
        const section = state.section?.entities?.[id];
        return [
          id,
          section
            ? {
                title: section.title,
                isExpanded: section.isExpanded,
                tasks: section.taskIds.map(
                  (taskId) => tasks[taskId]?.title ?? `[missing:${taskId}]`,
                ),
              }
            : null,
        ];
      }),
    );
  }, sectionIds);

const dispatch = async (page: Page, action: Record<string, unknown>): Promise<void> => {
  const ok = await page.evaluate((a) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) return false;
    store.dispatch(a);
    return true;
  }, action);
  expect(ok).toBe(true);
};

const getTaskId = async (page: Page, title: string): Promise<string> => {
  const id = await page.evaluate((taskTitle) => {
    type TaskLike = { id: string; title: string };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) return null;
    let state: { tasks?: { entities?: Record<string, TaskLike | undefined> } } = {};
    store.subscribe((value) => (state = value as typeof state)).unsubscribe();
    return (
      Object.values(state.tasks?.entities ?? {}).find((t) => t?.title === taskTitle)
        ?.id ?? null
    );
  }, title);
  if (!id) throw new Error(`Task "${title}" not found`);
  return id;
};

const addSection = (id: string, title: string): Record<string, unknown> => ({
  type: '[Section] Add Section',
  section: {
    id,
    contextId: 'TODAY',
    contextType: 'TAG',
    title,
    isExpanded: true,
    taskIds: [],
  },
  meta: { isPersistent: true, entityType: 'SECTION', entityId: id, opType: 'CRT' },
});

/** The action task-list.component.ts dispatches for a drag between sections. */
const moveTask = (
  taskId: string,
  sectionId: string,
  sourceSectionId: string | null,
  afterTaskId: string | null,
): Record<string, unknown> => ({
  type: '[Section] Add Task to Section',
  sectionId,
  taskId,
  afterTaskId,
  sourceSectionId,
  meta: {
    isPersistent: true,
    entityType: 'SECTION',
    ...(sourceSectionId && sourceSectionId !== sectionId
      ? { entityIds: [sourceSectionId, sectionId] }
      : { entityId: sectionId }),
    opType: 'MOV',
  },
});

/** The action the section header (collapse, rename) dispatches. */
const updateSection = (
  id: string,
  changes: Record<string, unknown>,
): Record<string, unknown> => ({
  type: '[Section] Update Section',
  section: { id, changes },
  meta: { isPersistent: true, entityType: 'SECTION', entityId: id, opType: 'UPD' },
});

/** Task titles in the TODAY tag's order, which a removal from a section writes. */
const readTodayOrder = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    type State = {
      tasks?: { entities?: Record<string, { title: string } | undefined> };
      tag?: { entities?: Record<string, { taskIds: string[] } | undefined> };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: State = {};
    store.subscribe((value) => (state = value as State)).unsubscribe();
    const tasks = state.tasks?.entities ?? {};
    return (state.tag?.entities?.['TODAY']?.taskIds ?? []).map(
      (taskId) => tasks[taskId]?.title ?? `[missing:${taskId}]`,
    );
  });

/** The action task-list.component.ts dispatches for a drag to the no-section bucket. */
const removeTask = (taskId: string, sectionId: string): Record<string, unknown> => ({
  type: '[Section] Remove Task from Section',
  sectionId,
  taskId,
  workContextId: 'TODAY',
  workContextType: 'TAG',
  workContextAfterTaskId: null,
  meta: { isPersistent: true, entityType: 'SECTION', entityId: sectionId, opType: 'UPD' },
});

type Edit = 'collapse of the source section' | 'rename of the destination section';
type FirstToSync = 'editor syncs first' | 'mover syncs first';

const EDITS: Edit[] = [
  'collapse of the source section',
  'rename of the destination section',
];
const ORDERS: FirstToSync[] = ['editor syncs first', 'mover syncs first'];

test.describe('@supersync Cross-section task move vs concurrent section edit (#10969)', () => {
  for (const edit of EDITS) {
    for (const order of ORDERS) {
      test(`move S1 → S2 vs ${edit}, ${order}`, async ({
        browser,
        baseURL,
        testRunId,
      }) => {
        test.setTimeout(180000);
        const appUrl = baseURL || 'http://localhost:4242';
        const s1 = `s1-${testRunId}`;
        const s2 = `s2-${testRunId}`;
        const moverTitle = `A-${testRunId}-Mover`;
        const stayTitle = `A-${testRunId}-Stay`;
        const otherTitle = `A-${testRunId}-Other`;
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
          await clientA.workView.addTask('Stay');
          await clientA.workView.addTask('Other');
          const mover = await getTaskId(clientA.page, moverTitle);
          const stay = await getTaskId(clientA.page, stayTitle);
          const other = await getTaskId(clientA.page, otherTitle);
          await dispatch(clientA.page, addSection(s1, 'One'));
          await dispatch(clientA.page, addSection(s2, 'Two'));
          await dispatch(clientA.page, moveTask(mover, s1, null, null));
          await dispatch(clientA.page, moveTask(stay, s1, null, mover));
          await dispatch(clientA.page, moveTask(other, s2, null, null));
          await clientA.sync.syncAndWait();

          clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
          await clientB.workView.waitForTaskList();
          await clientB.sync.setupSuperSync(syncConfig);
          await clientB.sync.syncAndWait();

          const seeded = {
            [s1]: { title: 'One', isExpanded: true, tasks: [moverTitle, stayTitle] },
            [s2]: { title: 'Two', isExpanded: true, tasks: [otherTitle] },
          };
          expect(await readSections(clientA.page, [s1, s2])).toEqual(seeded);
          expect(await readSections(clientB.page, [s1, s2])).toEqual(seeded);

          // Client A drags "Mover" from S1 to the top of S2.
          await dispatch(clientA.page, moveTask(mover, s2, s1, null));
          // Client B, concurrently, edits one of the two sections.
          const isCollapse = edit === 'collapse of the source section';
          await dispatch(
            clientB.page,
            isCollapse
              ? updateSection(s1, { isExpanded: false })
              : updateSection(s2, { title: 'Renamed' }),
          );

          const [first, second] =
            order === 'editor syncs first' ? [clientB, clientA] : [clientA, clientB];
          await first.sync.syncAndWait();
          await second.sync.syncAndWait();
          await first.sync.syncAndWait();
          await second.sync.syncAndWait();

          const expected = {
            [s1]: { title: 'One', isExpanded: !isCollapse, tasks: [stayTitle] },
            [s2]: {
              title: isCollapse ? 'Two' : 'Renamed',
              isExpanded: true,
              tasks: [moverTitle, otherTitle],
            },
          };
          expect({
            clientA: await readSections(clientA.page, [s1, s2]),
            clientB: await readSections(clientB.page, [s1, s2]),
          }).toEqual({ clientA: expected, clientB: expected });

          // Persisted, not only in memory.
          await clientA.page.reload();
          await clientA.workView.waitForTaskList();
          await clientB.page.reload();
          await clientB.workView.waitForTaskList();
          expect(await readSections(clientA.page, [s1, s2])).toEqual(expected);
          expect(await readSections(clientB.page, [s1, s2])).toEqual(expected);

          // A fresh device replays the server history to the same state.
          clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
          await clientC.workView.waitForTaskList();
          await clientC.sync.setupSuperSync(syncConfig);
          await clientC.sync.syncAndWait();
          expect(await readSections(clientC.page, [s1, s2])).toEqual(expected);
        } finally {
          if (clientA) await closeClient(clientA);
          if (clientB) await closeClient(clientB);
          if (clientC) await closeClient(clientC);
        }
      });
    }
  }
});

type OtherTaskDrag =
  | 'another task moved S3 → S1'
  | 'another task moved S3 → top of S2'
  | 'another task reordered within S2'
  | 'another task removed from S1'
  | 'another task removed from S1 too';
type DragOrder = 'other drag syncs first' | 'mover syncs first';

const OTHER_TASK_DRAGS: OtherTaskDrag[] = [
  'another task moved S3 → S1',
  'another task moved S3 → top of S2',
  'another task reordered within S2',
  'another task removed from S1',
  'another task removed from S1 too',
];
const DRAG_ORDERS: DragOrder[] = ['other drag syncs first', 'mover syncs first'];

test.describe('@supersync Section drag vs concurrent drag of another task (#10969)', () => {
  for (const drag of OTHER_TASK_DRAGS) {
    // The removal pair: both tasks go to the top of the TODAY order.
    const isRemovalPair = drag === 'another task removed from S1 too';
    const moverDrag = isRemovalPair ? 'Mover removed from S1' : 'move S1 → S2';
    for (const order of DRAG_ORDERS) {
      test(`${moverDrag} vs ${drag}, ${order}`, async ({
        browser,
        baseURL,
        testRunId,
      }) => {
        test.setTimeout(180000);
        const appUrl = baseURL || 'http://localhost:4242';
        const s1 = `s1-${testRunId}`;
        const s2 = `s2-${testRunId}`;
        const s3 = `s3-${testRunId}`;
        const title = (name: string): string => `A-${testRunId}-${name}`;
        let clientA: SimulatedE2EClient | null = null;
        let clientB: SimulatedE2EClient | null = null;
        let clientC: SimulatedE2EClient | null = null;

        try {
          const user = await createTestUser(testRunId);
          const syncConfig = getSuperSyncConfig(user);

          clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
          await clientA.workView.waitForTaskList();
          await clientA.sync.setupSuperSync(syncConfig);
          const id: Record<string, string> = {};
          for (const name of ['Mover', 'Stay', 'Other', 'Last', 'Extra']) {
            await clientA.workView.addTask(name);
            id[name] = await getTaskId(clientA.page, title(name));
          }
          await dispatch(clientA.page, addSection(s1, 'One'));
          await dispatch(clientA.page, addSection(s2, 'Two'));
          await dispatch(clientA.page, addSection(s3, 'Three'));
          await dispatch(clientA.page, moveTask(id.Mover, s1, null, null));
          await dispatch(clientA.page, moveTask(id.Stay, s1, null, id.Mover));
          await dispatch(clientA.page, moveTask(id.Other, s2, null, null));
          await dispatch(clientA.page, moveTask(id.Last, s2, null, id.Other));
          await dispatch(clientA.page, moveTask(id.Extra, s3, null, null));
          await clientA.sync.syncAndWait();

          clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
          await clientB.workView.waitForTaskList();
          await clientB.sync.setupSuperSync(syncConfig);
          await clientB.sync.syncAndWait();

          const ids = [s1, s2, s3];
          const tasksOf = async (page: Page): Promise<Record<string, string[]>> =>
            Object.fromEntries(
              Object.entries(await readSections(page, ids)).map(([sid, s]) => [
                sid,
                s?.tasks ?? ['[section missing]'],
              ]),
            );
          const seeded = {
            [s1]: [title('Mover'), title('Stay')],
            [s2]: [title('Other'), title('Last')],
            [s3]: [title('Extra')],
          };
          expect(await tasksOf(clientA.page)).toEqual(seeded);
          expect(await tasksOf(clientB.page)).toEqual(seeded);

          // Client A drags "Mover" from S1 to the top of S2 (or out of S1).
          await dispatch(
            clientA.page,
            isRemovalPair ? removeTask(id.Mover, s1) : moveTask(id.Mover, s2, s1, null),
          );
          // Client B, concurrently, drags a different task in S1 or S2.
          let expected: Record<string, string[]>;
          if (drag === 'another task moved S3 → S1') {
            await dispatch(clientB.page, moveTask(id.Extra, s1, s3, null));
            expected = {
              [s1]: [title('Extra'), title('Stay')],
              [s2]: [title('Mover'), title('Other'), title('Last')],
              [s3]: [],
            };
          } else if (drag === 'another task moved S3 → top of S2') {
            // Both tasks land at the top of S2, so the order depends on the
            // reissue: the rejected op is replayed below the accepted one.
            await dispatch(clientB.page, moveTask(id.Extra, s2, s3, null));
            const top =
              order === 'other drag syncs first'
                ? [title('Extra'), title('Mover')]
                : [title('Mover'), title('Extra')];
            expected = {
              [s1]: [title('Stay')],
              [s2]: [...top, title('Other'), title('Last')],
              [s3]: [],
            };
          } else if (drag === 'another task reordered within S2') {
            await dispatch(clientB.page, moveTask(id.Other, s2, s2, id.Last));
            expected = {
              [s1]: [title('Stay')],
              [s2]: [title('Mover'), title('Last'), title('Other')],
              [s3]: [title('Extra')],
            };
          } else if (isRemovalPair) {
            await dispatch(clientB.page, removeTask(id.Stay, s1));
            expected = {
              [s1]: [],
              [s2]: [title('Other'), title('Last')],
              [s3]: [title('Extra')],
            };
          } else {
            await dispatch(clientB.page, removeTask(id.Stay, s1));
            expected = {
              [s1]: [],
              [s2]: [title('Mover'), title('Other'), title('Last')],
              [s3]: [title('Extra')],
            };
          }

          const [first, second] =
            order === 'other drag syncs first' ? [clientB, clientA] : [clientA, clientB];
          await first.sync.syncAndWait();
          await second.sync.syncAndWait();
          await first.sync.syncAndWait();
          await second.sync.syncAndWait();

          expect({
            clientA: await tasksOf(clientA.page),
            clientB: await tasksOf(clientB.page),
          }).toEqual({ clientA: expected, clientB: expected });
          // A reissued removal also writes the TODAY order, which must converge.
          const todayOrder = await readTodayOrder(clientA.page);
          expect(await readTodayOrder(clientB.page)).toEqual(todayOrder);
          if (isRemovalPair) {
            // The rejected removal is replayed below the accepted one.
            expect(todayOrder.slice(0, 2)).toEqual(
              order === 'other drag syncs first'
                ? [title('Stay'), title('Mover')]
                : [title('Mover'), title('Stay')],
            );
          }

          // Persisted, not only in memory.
          await clientA.page.reload();
          await clientA.workView.waitForTaskList();
          await clientB.page.reload();
          await clientB.workView.waitForTaskList();
          expect(await tasksOf(clientA.page)).toEqual(expected);
          expect(await tasksOf(clientB.page)).toEqual(expected);
          expect(await readTodayOrder(clientA.page)).toEqual(todayOrder);
          expect(await readTodayOrder(clientB.page)).toEqual(todayOrder);

          // A fresh device replays the server history to the same state.
          clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
          await clientC.workView.waitForTaskList();
          await clientC.sync.setupSuperSync(syncConfig);
          await clientC.sync.syncAndWait();
          expect(await tasksOf(clientC.page)).toEqual(expected);
          expect(await readTodayOrder(clientC.page)).toEqual(todayOrder);
        } finally {
          if (clientA) await closeClient(clientA);
          if (clientB) await closeClient(clientB);
          if (clientC) await closeClient(clientC);
        }
      });
    }
  }
});
