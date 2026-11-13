import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';
import type { Page } from '@playwright/test';

// The suite otherwise picks a DST-free zone. Construct dates in the browser
// below so the runner's timezone cannot change the Berlin fall-back scenario.
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

for (const scenario of [
  {
    name: 'default boundary',
    offset: '00:00',
    start: '2026-06-15',
    next: '2026-06-16',
    reload: true,
  },
  {
    name: '04:00 boundary on reopen',
    offset: '04:00',
    start: '2026-06-15',
    next: '2026-06-16',
    reload: true,
  },
  {
    name: '04:00 boundary while open',
    offset: '04:00',
    start: '2026-06-15',
    next: '2026-06-16',
    reload: false,
  },
  {
    name: '04:00 boundary at fall-back',
    offset: '04:00',
    start: '2026-10-24',
    next: '2026-10-25',
    reload: true,
  },
]) {
  test(`preserves an overdue 02:00 schedule across ${scenario.name}`, async ({
    page,
    workViewPage,
  }) => {
    await page.clock.setSystemTime(
      await page.evaluate((day) => new Date(`${day}T23:00:00`).getTime(), scenario.start),
    );
    await page.reload();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Synthetic night schedule');

    // Dispatch the actual config/scheduling actions through the running app's
    // store. Startup, effects, meta-reducers, persistence and replay are real.
    const dueWithTime = await page.evaluate(
      (day) => new Date(`${day}T02:00:00`).getTime(),
      scenario.next,
    );
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
    await flushPendingWrites(page);

    await page.clock.setSystemTime(
      await page.evaluate((day) => new Date(`${day}T09:00:00`).getTime(), scenario.next),
    );
    if (scenario.reload) await page.reload();
    else await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await workViewPage.waitForTaskList();
    // The two real day-change effects debounce for one and two seconds.
    await page.waitForTimeout(4000);
    await flushPendingWrites(page);
    expect.soft(await readSchedule(page, id)).toEqual({ dueWithTime, dueDay: null });

    // The overdue schedule must survive subsequent hydration as well.
    await page.reload();
    await workViewPage.waitForTaskList();
    expect.soft(await readSchedule(page, id)).toEqual({ dueWithTime, dueDay: null });
  });
}
