import type { Store } from '@ngrx/store';
import type {
  TaskRepeatCfg,
  TaskRepeatCfgState,
} from '../../../src/app/features/task-repeat-cfg/task-repeat-cfg.model';
import type { Task } from '../../../src/app/features/tasks/task.model';
import { DEFAULT_TASK_REPEAT_CFG } from '../../../src/app/features/task-repeat-cfg/task-repeat-cfg.model';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

test('duplicated project keeps an independent recurrence after deleting the original', async ({
  page,
  projectPage,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await projectPage.createProject('Recurring project');
  await projectPage.navigateToProjectByName('Recurring project');
  await workViewPage.waitForTaskList();
  const title = `${testPrefix}-Recurring task`;
  await workViewPage.addTask(title);
  const original = await page.evaluate(
    ({ taskTitle, defaults }) => {
      const store = (
        window as unknown as {
          __e2eTestHelpers: { store: Store<RootState> };
        }
      ).__e2eTestHelpers.store;
      let state: RootState | undefined;
      store.subscribe((value) => (state = value)).unsubscribe();
      const task = Object.values(state!.tasks.entities).find(
        (candidate) => candidate?.title === taskTitle,
      );
      if (!task) throw new Error('Original task missing');
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const previous = new Date(today);
      previous.setDate(previous.getDate() - 1);
      const dateStr = (date: Date): string =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const previousDay = dateStr(previous);
      const cfg = {
        ...defaults,
        id: 'original-repeat',
        projectId: task.projectId,
        title: task.title,
        repeatEvery: 3,
        repeatCycle: 'DAILY',
        quickSetting: 'CUSTOM',
        repeatFromCompletionDate: true,
        startDate: previousDay,
        lastTaskCreationDay: previousDay,
        lastTaskCreation: previous.getTime(),
      };
      store.dispatch({
        type: '[TaskRepeatCfg] Upsert TaskRepeatCfg',
        taskRepeatCfg: cfg,
        meta: {
          isPersistent: true,
          entityType: 'TASK_REPEAT_CFG',
          entityId: cfg.id,
          opType: 'CRT',
        },
      });
      store.dispatch({
        type: '[Task Shared] updateTask',
        task: {
          id: task.id,
          changes: {
            repeatCfgId: cfg.id,
            created: previous.getTime(),
            dueDay: previousDay,
          },
        },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
      return {
        projectId: task.projectId,
        cfgId: cfg.id,
        today: dateStr(today),
        created: previous.getTime(),
      };
    },
    { taskTitle: title, defaults: DEFAULT_TASK_REPEAT_CFG },
  );
  await flushPendingWrites(page);
  await projectPage.openProjectContextMenu('Recurring project');
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();

  const readCopy = (): Promise<{ task: Task; cfg: TaskRepeatCfg } | null> =>
    page.evaluate(
      ({ projectId, taskTitle }) => {
        type State = RootState & { taskRepeatCfg: TaskRepeatCfgState };
        const store = (
          window as unknown as {
            __e2eTestHelpers: { store: Store<State> };
          }
        ).__e2eTestHelpers.store;
        let state: State | undefined;
        store.subscribe((value) => (state = value)).unsubscribe();
        const task = Object.values(state!.tasks.entities).find(
          (candidate) =>
            candidate?.title === taskTitle && candidate.projectId !== projectId,
        );
        const cfg = task?.repeatCfgId
          ? state!.taskRepeatCfg.entities[task.repeatCfgId]
          : undefined;
        return task && cfg ? { task, cfg } : null;
      },
      { projectId: original.projectId, taskTitle: title },
    );
  await expect.poll(readCopy).not.toBeNull();
  const copy = (await readCopy())!;
  expect(copy.cfg.id).not.toBe(original.cfgId);
  expect(copy.cfg.projectId).toBe(copy.task.projectId);
  expect(copy.cfg.repeatEvery).toBe(3);
  expect(copy.task.created).toBe(original.created);
  await page.evaluate((cfgId) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: Store<RootState> };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Task Shared] deleteTaskRepeatCfg',
      taskRepeatCfgId: cfgId,
      meta: {
        isPersistent: true,
        entityType: 'TASK_REPEAT_CFG',
        entityId: cfgId,
        opType: 'DEL',
      },
    });
  }, original.cfgId);
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect.poll(readCopy).toMatchObject({
    cfg: copy.cfg,
    task: {
      id: copy.task.id,
      projectId: copy.task.projectId,
      repeatCfgId: copy.cfg.id,
      dueDay: copy.task.dueDay,
    },
  });
  await page.goto(`/#/project/${copy.task.projectId}/tasks`);
  await workViewPage.waitForTaskList();
  await taskPage.markTaskAsDone(page.locator(`task[data-task-id="${copy.task.id}"]`));
  await expect
    .poll(async () => (await readCopy())?.cfg.lastTaskCreationDay)
    .toBe(original.today);
});
