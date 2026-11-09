import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';
import type { Page } from '@playwright/test';

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

for (const scenario of [
  { offset: '00:00', expected: '2026-06-17' },
  { offset: '04:00', expected: '2026-06-16' },
]) {
  test(`reminder tomorrow respects ${scenario.offset} day start`, async ({
    page,
    workViewPage,
  }) => {
    await page.clock.setSystemTime(new Date('2026-06-16T02:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Synthetic night schedule');
    // Dispatch the actual config/scheduling actions through the running app's
    // store. Startup, effects, meta-reducers, persistence and replay are real.
    const dueWithTime = new Date('2026-06-16T01:59:00').getTime();
    const id = await page.evaluate(
      ({ due, offset }) => {
        type Task = { id: string; title: string };
        type State = { tasks: { entities: Record<string, Task> } };
        const store = (
          window as unknown as {
            __e2eTestHelpers: {
              store: {
                dispatch: (a: unknown) => void;
                subscribe: (fn: (s: State) => void) => { unsubscribe: () => void };
              };
            };
          }
        ).__e2eTestHelpers.store;
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
        let task: Task | undefined;
        store
          .subscribe((s) => {
            task = Object.values(s.tasks.entities).find((t) =>
              t.title.includes('Synthetic night schedule'),
            );
          })
          .unsubscribe();
        if (!task) throw new Error('Synthetic task missing');
        store.dispatch({
          type: '[Task Shared] scheduleTaskWithTime',
          task,
          dueWithTime: due,
          remindAt: due,
          isMoveToBacklog: false,
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: task.id,
            opType: 'UPD',
          },
        });
        return task.id;
      },
      { due: dueWithTime, offset: scenario.offset },
    );
    await expect
      .poll(() => readSchedule(page, id))
      .toEqual({ dueWithTime, dueDay: null });

    const dialog = page.locator('dialog-view-task-reminder');
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog
      .locator('mat-dialog-actions')
      .getByRole('button', { name: 'More actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Reschedule for tomorrow' }).click();
    await expect(dialog).toBeHidden();
    await flushPendingWrites(page);
    expect
      .soft(await readSchedule(page, id))
      .toEqual({ dueWithTime: null, dueDay: scenario.expected });
    await page.reload();
    await workViewPage.waitForTaskList();
    expect(await readSchedule(page, id)).toEqual({
      dueWithTime: null,
      dueDay: scenario.expected,
    });
  });
}
