import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';
import type { Page } from '@playwright/test';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

test.use({ timezoneId: 'Europe/Berlin' });

const readSchedule = async (
  page: Page,
  id: string,
): Promise<{ dueWithTime: number | null; dueDay: string | null } | undefined> =>
  page.evaluate((taskId) => {
    type State = {
      tasks: {
        entities: Record<string, { dueWithTime?: number; dueDay?: string }>;
      };
    };
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (s: State) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers;
    let result: { dueWithTime: number | null; dueDay: string | null } | undefined;
    helpers.store
      .subscribe((s) => {
        const task = s.tasks.entities[taskId];
        result = { dueWithTime: task?.dueWithTime ?? null, dueDay: task?.dueDay ?? null };
      })
      .unsubscribe();
    return result;
  }, id);

test('preserves a future schedule when the day boundary changes during planning', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-16T01:00:00+02:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Future night schedule');
  await workViewPage.addTask('Recurring planning trigger');
  await taskPage.openTaskDetail(taskPage.getTaskByText('Recurring planning trigger'));
  await openRecurDialog(page);
  await saveRecurDialog(page);

  const dueWithTime = new Date('2026-06-17T02:00:00+02:00').getTime();
  const id = await page.evaluate((due) => {
    type Task = { id: string; title: string; repeatCfgId?: string };
    type State = {
      tasks: { entities: Record<string, Task> };
      planner: { days: Record<string, string[]> };
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            dispatch: (action: unknown) => void;
            subscribe: (fn: (s: State) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let state!: State;
    store.subscribe((s) => (state = s)).unsubscribe();
    const task = Object.values(state.tasks.entities).find((t) =>
      t.title.includes('Future night schedule'),
    );
    const repeatCfgId = Object.values(state.tasks.entities).find((t) =>
      t.title.includes('Recurring planning trigger'),
    )?.repeatCfgId;
    if (!task || !repeatCfgId) throw new Error('Synthetic tasks missing');

    const updateOffset = (offset: string): void =>
      store.dispatch({
        type: '[Global Config] Update Global Config Section',
        sectionKey: 'misc',
        sectionCfg: { startOfNextDayTime: offset },
        isSkipSnack: true,
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'misc',
          opType: 'UPD',
        },
      });
    const updatePaused = (isPaused: boolean): void =>
      store.dispatch({
        type: '[TaskRepeatCfg] Update TaskRepeatCfg',
        taskRepeatCfg: { id: repeatCfgId, changes: { isPaused } },
        meta: {
          isPersistent: true,
          entityType: 'TASK_REPEAT_CFG',
          entityId: repeatCfgId,
          opType: 'UPD',
        },
      });
    updateOffset('00:00');
    store.dispatch({
      type: '[Task Shared] scheduleTaskWithTime',
      task,
      dueWithTime: due,
      isMoveToBacklog: false,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: task.id,
        opType: 'UPD',
      },
    });
    store.subscribe((s) => (state = s)).unsubscribe();
    if (Object.values(state.planner.days).some((ids) => ids.includes(task.id))) {
      throw new Error('Scheduled task must have no explicit planner placement');
    }

    updatePaused(true);
    // The real resume effect calls addAllDueToday synchronously. It captures
    // June 16 / zero offset, then yields. Change the live setting in that gap:
    // Today becomes June 15, while June 17 at 02:00 belongs to June 16.
    updatePaused(false);
    updateOffset('04:00');
    return task.id;
  }, dueWithTime);

  // Allow the service's event-loop yields and the real day-change debounces.
  await page.waitForTimeout(4000);
  await flushPendingWrites(page);
  expect.soft(await readSchedule(page, id)).toEqual({ dueWithTime, dueDay: null });
  await page.reload();
  await workViewPage.waitForTaskList();
  expect.soft(await readSchedule(page, id)).toEqual({ dueWithTime, dueDay: null });
});
