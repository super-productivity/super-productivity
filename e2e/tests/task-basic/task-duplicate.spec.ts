import type { Store } from '@ngrx/store';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

interface SubtaskSchedule {
  title: string;
  isDone: boolean;
  dueDay: string | null;
  dueWithTime: number | null;
}

const readSubtaskSchedules = async (
  page: Page,
  parentTitle: string,
): Promise<SubtaskSchedule[] | null> =>
  page.evaluate((title) => {
    const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
      .__e2eTestHelpers.store;
    let state: RootState | undefined;
    store.subscribe((value) => (state = value)).unsubscribe();
    if (!state) {
      throw new Error('Task store is not ready');
    }
    const tasks = state.tasks.entities;
    const parent = Object.values(tasks).find((task) => task?.title === title);
    if (!parent) {
      return null;
    }
    return parent.subTaskIds.map((id) => {
      const task = tasks[id];
      if (!task) {
        throw new Error(`Missing subtask ${id}`);
      }
      return {
        title: task.title,
        isDone: task.isDone,
        dueDay: task.dueDay ?? null,
        dueWithTime: task.dueWithTime ?? null,
      };
    });
  }, parentTitle);

test('duplicating a parent in Today preserves undated and scheduled subtasks', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  const parentTitle = `${testPrefix}-Parent`;
  await workViewPage.addTask(parentTitle);
  const parent = taskPage.getTaskByText(parentTitle);
  for (const title of ['Undated subtask', 'All-day subtask', 'Timed subtask']) {
    await workViewPage.addSubTask(parent, title);
  }
  await expect(taskPage.getSubTasks(parent)).toHaveCount(3);

  const dueDay = '2099-12-30';
  const dueWithTime = new Date('2099-12-31T12:00:00Z').getTime();
  await page.evaluate(
    ({ title, day, time }) => {
      const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
        .__e2eTestHelpers.store;
      let state: RootState | undefined;
      store.subscribe((value) => (state = value)).unsubscribe();
      const task = Object.values(state?.tasks.entities ?? {}).find(
        (candidate) => candidate?.title === title,
      );
      if (!task || task.subTaskIds.length !== 3) {
        throw new Error('Parent and subtasks must exist before scheduling');
      }
      for (const [index, changes] of [
        [1, { dueDay: day }],
        [2, { dueWithTime: time }],
      ] as const) {
        const id = task.subTaskIds[index];
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id, changes },
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
        });
      }
    },
    { title: parentTitle, day: dueDay, time: dueWithTime },
  );
  const expected = [
    {
      title: 'Undated subtask',
      isDone: false,
      dueDay: null,
      dueWithTime: null,
    },
    {
      title: 'All-day subtask',
      isDone: false,
      dueDay,
      dueWithTime: null,
    },
    {
      title: 'Timed subtask',
      isDone: false,
      dueDay: null,
      dueWithTime,
    },
  ];
  await expect.poll(() => readSubtaskSchedules(page, parentTitle)).toEqual(expected);

  await parent.focus();
  await parent.press('Control+d');
  const copyTitle = `${parentTitle} (copy)`;
  await expect(taskPage.getTaskByText(copyTitle)).toBeVisible();
  await expect.poll(() => readSubtaskSchedules(page, copyTitle)).toEqual(expected);
  await expect.poll(() => readSubtaskSchedules(page, parentTitle)).toEqual(expected);

  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect.poll(() => readSubtaskSchedules(page, copyTitle)).toEqual(expected);
});
