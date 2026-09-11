import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/9728
 *
 * A daily recurring task with inherited subtasks shows every subtask twice
 * after the instance is created on more than one device.
 *
 * Why it happens: the repeat INSTANCE has a deterministic id
 * (getRepeatableTaskId -> `rpt_<cfgId>_<dueDay>`), so two devices creating the
 * same day's instance collide on one entity and conflict resolution keeps one.
 * Its SUBTASKS used to get fresh nanoid ids, so the two devices produced
 * DISJOINT entity ids. Conflict detection keys on `ENTITY_TYPE:entityId`
 * (sync-core entity-key.util.ts), so those never form a conflict group and all
 * of them apply — one parent, 2x the subtasks.
 *
 * Fix: getRepeatableSubTaskId() makes subtask ids deterministic too, so the
 * second device's creation is a no-op for the whole instance.
 *
 * NOTE: no client goes offline here. Both simply reach the day change before
 * the other has synced, which is the ordinary case when two devices are open
 * around midnight.
 */

/**
 * Open a task's detail panel (mirrors TaskPage.openTaskDetail, which the
 * SuperSync harness does not expose — SimulatedE2EClient carries only
 * workView and sync). The panel is opened from the hover toolbar, not by
 * clicking the row.
 */
const openTaskDetail = async (
  page: SimulatedE2EClient['page'],
  taskName: string,
): Promise<void> => {
  // `:not(.hasNoSubTasks)` pins this to the parent — its subtask rows are
  // nested inside it and match :has-text() too.
  const task = page.locator(`task:not(.hasNoSubTasks):has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });
  // Hover the parent's OWN row: subtasks render inside the parent element, so
  // hovering the element centre lands on a subtask and opens ITS detail panel —
  // which has no repeat button (canRepeat requires !task.parentId).
  await task.locator('.first-line').first().hover();
  const showDetailBtn = page.getByRole('button', { name: 'Show/hide task panel' });
  await showDetailBtn.waitFor({ state: 'visible', timeout: 5000 });
  await showDetailBtn.click();
  await page.waitForTimeout(300);
};

/** Add a subtask via the 'a' keyboard shortcut (mirrors supersync-archive-subtasks). */
const addSubtask = async (
  page: SimulatedE2EClient['page'],
  parentTaskName: string,
  subtaskTitle: string,
): Promise<void> => {
  const parentTask = page.locator(`task:has-text("${parentTaskName}")`).first();
  await parentTask.waitFor({ state: 'visible', timeout: 10000 });
  await parentTask.focus();
  await page.waitForTimeout(100);
  await parentTask.press('a');

  const draftInput = page.locator('.e2e-add-subtask-input');
  await draftInput.waitFor({ state: 'visible', timeout: 5000 });
  await draftInput.fill(subtaskTitle);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await draftInput.waitFor({ state: 'detached', timeout: 5000 });

  await waitForTask(page, subtaskTitle);
  await page.waitForTimeout(200);
};

/**
 * Locate the CURRENT (undone) instance of the recurring parent.
 * Scoping subtask counts to it is load-bearing: the previous day's instance is
 * still in state after the day change, so a global count sees both instances.
 */
const currentInstance = (
  page: SimulatedE2EClient['page'],
  parentName: string,
): ReturnType<SimulatedE2EClient['page']['locator']> =>
  page
    .locator(
      `task:not(.hasNoSubTasks):not(.isDone):not(.ng-animating):has-text("${parentName}")`,
    )
    .first();

/**
 * Move a client past midnight and wait for the fresh instance to appear.
 * setSystemTime (not setFixedTime) so Date.now() keeps advancing — the
 * day-change effect chain's debounceTime(1000) needs a moving clock (#6230).
 */
const advancePastMidnight = async (
  client: SimulatedE2EClient,
  parentName: string,
): Promise<void> => {
  // Finish the current instance first, so the one created after midnight is
  // unambiguous and the wait below cannot match the old one.
  const prev = currentInstance(client.page, parentName);
  const prevId = await prev.getAttribute('data-task-id');
  await prev.locator('.first-line').first().focus();
  await prev.press('d');
  const confirmBtn = client.page.locator('dialog-confirm button[mat-flat-button]');
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
  }
  // Assert via the id, not `prev`: that locator excludes .isDone, so it stops
  // matching the instant the task is done and could never satisfy the check.
  // Poll for a done copy rather than asserting on the single element: while the
  // list animates, the same task id is rendered twice — once animating out of
  // the undone list, once already .isDone in the done list.
  await expect
    .poll(() => client.page.locator(`task[data-task-id="${prevId}"].isDone`).count(), {
      timeout: 10000,
    })
    .toBeGreaterThan(0);

  await client.page.clock.setSystemTime(new Date('2026-06-16T00:05:00'));
  await client.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(currentInstance(client.page, parentName)).toBeVisible({
    timeout: 60000,
  });
};

test.describe('@supersync Recurring subtask duplication (#9728)', () => {
  test('creates each inherited subtask once when two devices reach the day change', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      const parentName = `Routine-${testRunId}`;
      const sub1 = `Step1-${testRunId}`;
      const sub2 = `Step2-${testRunId}`;

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      // Both devices start mid-afternoon on day 15. Deliberately NOT close to
      // midnight: sync setup plus encryption takes minutes of real time, and
      // setSystemTime lets the clock keep ticking, so a 23:55 start crosses
      // midnight mid-setup and re-triggers the day-change machinery on top of
      // the encryption dialog. advancePastMidnight() jumps to day 16 later.
      for (const client of [clientA, clientB]) {
        await client.page.clock.setSystemTime(new Date('2026-06-15T15:00:00'));
        await client.page.reload();
        await client.workView.waitForTaskList();
      }

      await clientA.sync.setupSuperSync(syncConfig);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Device A builds the routine: a parent with two subtasks...
      await clientA.workView.addTask(parentName);
      await waitForTask(clientA.page, parentName);
      await addSubtask(clientA.page, parentName, sub1);
      await addSubtask(clientA.page, parentName, sub2);

      // 2. ...and makes it a daily repeat. shouldInheritSubtasks defaults to true
      //    when the task already has subtasks (dialog-edit-task-repeat-cfg.component.ts).
      await openTaskDetail(clientA.page, parentName);
      await openRecurDialog(clientA.page);
      await saveRecurDialog(clientA.page);
      await clientA.page.keyboard.press('Escape');

      // 3. Both devices agree on the config and day-15 instance.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, parentName);

      // 4. THE SCENARIO: both devices cross midnight before either syncs, so both
      //    independently create the day-16 instance and its inherited subtasks.
      await advancePastMidnight(clientA, parentName);
      await advancePastMidnight(clientB, parentName);

      // 5. Converge.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      // 6. Each inherited subtask must exist exactly once on BOTH devices.
      //    Before the fix this is 2 per device (#9728).
      for (const [name, client] of [
        ['A', clientA],
        ['B', clientB],
      ] as const) {
        const instance = currentInstance(client.page, parentName);
        await expect(
          instance.locator('.sub-tasks task'),
          `client ${name}: the new instance should carry exactly 2 subtasks`,
        ).toHaveCount(2, { timeout: 15000 });
        await expect(
          instance.locator(`.sub-tasks task:has-text("${sub1}")`),
          `client ${name}: "${sub1}" should appear once`,
        ).toHaveCount(1);
        await expect(
          instance.locator(`.sub-tasks task:has-text("${sub2}")`),
          `client ${name}: "${sub2}" should appear once`,
        ).toHaveCount(1);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
