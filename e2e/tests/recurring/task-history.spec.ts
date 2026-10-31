import { test, expect } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import type { RootState } from '../../../src/app/root-store/root-state';
import type { Task } from '../../../src/app/features/tasks/task.model';
import type { TaskHistoryState } from '../../../src/app/features/tasks/task-history/task-history.model';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';
import { waitForMenuSettled } from '../../utils/waits';

test.use({ timezoneId: 'Europe/Moscow' });

const snapshot = (page: Page): Promise<{ tasks: Task[]; history: TaskHistoryState }> =>
  page.evaluate(async () => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (read: (state: RootState) => void) => {
              unsubscribe: () => void;
            };
          };
          flushPendingWrites: () => Promise<void>;
        };
      }
    ).__e2eTestHelpers;
    await helpers.flushPendingWrites();
    let root: RootState | undefined;
    helpers.store.subscribe((state) => (root = state)).unsubscribe();
    return {
      tasks: Object.values(root!.tasks.entities).filter((task): task is Task => !!task),
      history: root!.tasks.taskHistory ?? {},
    };
  });

test('daily instances keep independent history through day change, bulk completion, reopen and restart', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  const title = `${testPrefix}-Daily history`;
  await page.clock.setSystemTime(new Date('2026-11-02T23:55:00+03:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(title);
  await taskPage.openTaskDetail(taskPage.getTaskByText(title).first());
  await openRecurDialog(page);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () =>
        (await snapshot(page)).tasks.filter(
          (task) => task.title === title && !!task.repeatCfgId && !task.isDone,
        ).length,
    )
    .toBe(1);
  const first = (await snapshot(page)).tasks.find(
    (task) => task.title === title && !!task.repeatCfgId && !task.isDone,
  )!;
  await taskPage.markTaskAsDone(page.locator(`task[id="t-${first.id}"]`).first());
  const completed = (await snapshot(page)).history[first.id];
  expect(
    Object.values(completed.events)
      .filter((event) => event.field === 'status')
      .map((event) => event.after),
  ).toEqual([{ kind: 'status', value: 'done' }]);

  await page.clock.setSystemTime(new Date('2026-11-03T00:05:00+03:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(taskPage.getUndoneTasks().filter({ hasText: title }).first()).toBeVisible({
    timeout: 60000,
  });
  const next = (await snapshot(page)).tasks.find(
    (task) =>
      task.title === title && task.repeatCfgId === first.repeatCfgId && !task.isDone,
  )!;
  expect(next.id).not.toBe(first.id);
  expect(next.dueDay).toBe('2026-11-03');
  const created = await snapshot(page);
  expect(created.history[first.id]).toEqual(completed);
  const nextHistory = created.history[next.id];
  expect(nextHistory.baseline?.taskId).toBe(next.id);
  expect(nextHistory.baseline?.createdAt).toBe(next.created);
  expect(nextHistory.baseline?.status).toEqual({ kind: 'status', value: 'open' });
  expect(
    Object.values(nextHistory.events).every((event) => event.taskId === next.id),
  ).toBe(true);
  expect(
    Object.values(nextHistory.events).filter((event) => event.field === 'status'),
  ).toEqual([]);
  const nextRow = page.locator(`task[id="t-${next.id}"]`).first();
  await taskPage.markTaskAsDone(nextRow);
  await nextRow.locator('done-toggle').click();
  const reopened = await snapshot(page);
  expect(
    Object.values(reopened.history[next.id].events)
      .filter((event) => event.field === 'status')
      .map((event) => event.after),
  ).toEqual([
    { kind: 'status', value: 'done' },
    { kind: 'status', value: 'open' },
  ]);
  expect(reopened.history[first.id]).toEqual(completed);

  await page.reload();
  await workViewPage.waitForTaskList();
  const restarted = await snapshot(page);
  expect(restarted.history[first.id]).toEqual(completed);
  expect(restarted.history[next.id]).toEqual(reopened.history[next.id]);
  expect(
    restarted.tasks
      .filter((task) => task.repeatCfgId === first.repeatCfgId && !task.isDone)
      .map((task) => task.id),
  ).toEqual([next.id]);

  const otherTitle = `${testPrefix}-Bulk neighbour`;
  await workViewPage.addTask(otherTitle);
  const other = (await snapshot(page)).tasks.find((task) => task.title === otherTitle)!;
  const beforeBulk = await snapshot(page);
  for (const id of [next.id, other.id]) {
    await page
      .locator(`task[id="t-${id}"]`)
      .first()
      .click({ modifiers: ['Control'] });
  }
  const bar = page.locator('task-multi-select-bar .bar');
  await expect(bar).toContainText('2 selected');
  for (const [label, isDone] of [
    ['Mark as completed', true],
    ['Mark as not completed', false],
  ] as const) {
    await bar.getByRole('button', { name: 'Actions' }).click();
    await waitForMenuSettled(page);
    await page.locator('.mat-mdc-menu-content button', { hasText: label }).click();
    await expect
      .poll(async () => {
        const state = await snapshot(page);
        return [next.id, other.id].every(
          (id) => state.tasks.find((task) => task.id === id)?.isDone === isDone,
        );
      })
      .toBe(true);
  }
  const bulk = await snapshot(page);
  for (const id of [next.id, other.id]) {
    const previousIds = new Set(Object.keys(beforeBulk.history[id].events));
    const added = Object.values(bulk.history[id].events).filter(
      (event) => !previousIds.has(event.id),
    );
    expect(added.map((event) => [event.taskId, event.field, event.after])).toEqual([
      [id, 'status', { kind: 'status', value: 'done' }],
      [id, 'status', { kind: 'status', value: 'open' }],
    ]);
    expect(new Set(added.map((event) => event.id)).size).toBe(2);
  }
  expect(bulk.history[first.id]).toEqual(completed);
  await page.reload();
  await workViewPage.waitForTaskList();
  const persistedBulk = await snapshot(page);
  for (const id of [first.id, next.id, other.id])
    expect(persistedBulk.history[id]).toEqual(bulk.history[id]);
});
