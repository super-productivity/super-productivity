import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  openRecurDialog,
  openRecurScheduleDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';
import { getStoreSummary } from '../../utils/audit-error-paths-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/11645
 *
 * Time tracked on a daily repeat instance on device A is lost on every device
 * after device B (which created the same day's instance without having
 * downloaded A's ops yet) syncs.
 *
 * Why: the instance id is deterministic (`rpt_<cfgId>_<dueDay>`), so B's
 * blank CREATE and A's CREATE + time-tracking ops hit one entity concurrently.
 * A CREATE cannot be field-patched, so whole-entity LWW used to pick B's newer
 * blank copy. Fix: the side that only created loses to the side that also
 * edited (`editedSideOfDuplicateCreate` in sync-core).
 *
 * Order mirrors the user's: A creates the instance and tracks time; only
 * afterwards, hours later, does B reach the day change (no sync in between).
 */

// A future year: the reminder check runs on real time, so a fake day in the
// past would pop the timed instance's reminder over the UI mid-test.
const DAY = '2030-06-16';

/**
 * Book time on a task by id through the two actions the production timer uses
 * (same as recordTaskTimeDelta, which matches by title and would hit the
 * previous day's instance of the same title).
 */
const recordTimeById = async (
  page: SimulatedE2EClient['page'],
  taskId: string,
  duration: number,
): Promise<void> => {
  await page.evaluate(
    async ({ id, date, delta }) => {
      type Store = {
        subscribe: (next: (s: unknown) => void) => { unsubscribe: () => void };
        dispatch: (a: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers: { store: Store } })
        .__e2eTestHelpers.store;
      let root: { tasks: { entities: Record<string, unknown> } } | undefined;
      store.subscribe((s) => (root = s as typeof root)).unsubscribe();
      const task = root!.tasks.entities[id];
      if (!task) throw new Error(`task ${id} not in store`);
      store.dispatch({
        type: '[TimeTracking] Add time spent',
        task,
        date,
        duration: delta,
        isFromTrackingReminder: false,
      });
      store.dispatch({
        type: '[TimeTracking] Sync time spent',
        taskId: id,
        date,
        duration: delta,
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
      });
    },
    { id: taskId, date: DAY, delta: duration },
  );
};

/** Persisted-in-store timeSpent of a task id (0 when absent). */
const readTaskNumber = (
  page: SimulatedE2EClient['page'],
  taskId: string,
  field: 'timeSpent' | 'dueWithTime',
): Promise<number> =>
  page.evaluate(
    ([id, key]) => {
      type Store = {
        subscribe: (n: (s: unknown) => void) => { unsubscribe: () => void };
      };
      const store = (window as unknown as { __e2eTestHelpers: { store: Store } })
        .__e2eTestHelpers.store;
      let root:
        | { tasks: { entities: Record<string, Record<string, number>> } }
        | undefined;
      store.subscribe((s) => (root = s as typeof root)).unsubscribe();
      return root!.tasks.entities[id]?.[key] ?? -1;
    },
    [taskId, field] as const,
  );
const readTimeSpent = (
  page: SimulatedE2EClient['page'],
  taskId: string,
): Promise<number> => readTaskNumber(page, taskId, 'timeSpent');

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
  const task = page.locator(`task:has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });
  await task.locator('.first-line').first().hover();
  const showDetailBtn = page.getByRole('button', { name: 'Show/hide task panel' });
  await showDetailBtn.waitFor({ state: 'visible', timeout: 5000 });
  await showDetailBtn.click();
  await page.waitForTimeout(300);
};

/**
 * Locate the CURRENT (undone) instance of the recurring parent.
 * The previous day's (done) instance is still in state after the day change,
 * so an unscoped title match could pick it.
 */
const currentInstance = (
  page: SimulatedE2EClient['page'],
  parentName: string,
): ReturnType<SimulatedE2EClient['page']['locator']> =>
  page.locator(`task:not(.isDone):not(.ng-animating):has-text("${parentName}")`).first();

/**
 * Move a client past midnight and wait for the fresh instance to appear.
 * setSystemTime (not setFixedTime) so Date.now() keeps advancing — the
 * day-change effect chain's debounceTime(1000) needs a moving clock (#6230).
 */
const advancePastMidnight = async (
  client: SimulatedE2EClient,
  parentName: string,
  at: string,
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

  await client.page.clock.setSystemTime(new Date(at));
  await client.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(currentInstance(client.page, parentName)).toBeVisible({
    timeout: 60000,
  });
};

// Both conflict directions: B resolves (A uploaded first, SuperSync's usual
// order) or A resolves (B's blank copy reached the server first).
// A start time makes creation also dispatch scheduleTaskWithTime, so both
// sides carry a follow-up op besides the create.
const SCENARIOS = [
  { name: 'A uploads its tracked time first', aUploadsFirst: true, startTime: null },
  {
    name: "B's blank copy reaches the server first",
    aUploadsFirst: false,
    startTime: null,
  },
  { name: 'timed, A uploads first', aUploadsFirst: true, startTime: '13:00' },
  { name: "timed, B's blank copy first", aUploadsFirst: false, startTime: '13:00' },
] as const;

test.describe('@supersync Repeat instance time loss (#11645)', () => {
  for (const { name: scenario, aUploadsFirst, startTime } of SCENARIOS) {
    test(`keeps time tracked on A when B creates the same instance later: ${scenario}`, async ({
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

        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

        for (const client of [clientA, clientB]) {
          await client.page.clock.setSystemTime(new Date('2030-06-15T15:00:00'));
          await client.page.reload();
          await client.workView.waitForTaskList();
        }
        await clientA.sync.setupSuperSync(syncConfig);
        await clientB.sync.setupSuperSync(syncConfig);

        // 1. A creates a daily repeat; both devices agree on it.
        await clientA.workView.addTask(parentName);
        await waitForTask(clientA.page, parentName);
        await openTaskDetail(clientA.page, parentName);
        await openRecurDialog(clientA.page);
        if (startTime) {
          // remindAt defaults to AtStart once startTime is set, so the config is timed.
          const scheduleDialog = await openRecurScheduleDialog(clientA.page);
          const startTimeField = scheduleDialog.getByLabel('Time');
          await startTimeField.fill(startTime);
          await startTimeField.blur();
          await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
          await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }
        await saveRecurDialog(clientA.page);
        await clientA.page.keyboard.press('Escape');
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, parentName);

        // 2. Day changes on A only: A creates the day-16 instance and tracks time.
        await advancePastMidnight(clientA, parentName, '2030-06-16T00:05:00');
        const instanceId = (await getStoreSummary(clientA.page)).tasks.find(
          (t) => t.title.includes(parentName) && !t.isDone && !t.parentId,
        )!.id;
        console.log(`[11645] instance id on A: ${instanceId}`);
        expect(instanceId).toMatch(/^rpt_/);
        const TRACKED_MS = 120000;
        await recordTimeById(clientA.page, instanceId, TRACKED_MS);
        expect(await readTimeSpent(clientA.page, instanceId)).toBe(TRACKED_MS);
        if (aUploadsFirst) await clientA.sync.syncAndWait();

        // 3. Only now (later in wall time, no sync since before the day change)
        //    does B reach the day change and create the same instance.
        // B opens hours later, as in the report: its create must be the newest
        // write, or LWW picks A's side by timestamp alone.
        await advancePastMidnight(clientB, parentName, '2030-06-16T09:00:00');
        console.log(
          `[11645] B timeSpent right after its own create: ${await readTimeSpent(clientB.page, instanceId)}`,
        );

        // 4. Converge. B syncs first either way; without A's earlier upload,
        //    B's blank copy is on the server before A's edits.
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();

        // 5. Time from A must survive on both devices; exactly one instance.
        for (const [name, client] of [
          ['A', clientA],
          ['B', clientB],
        ] as const) {
          const tasks = (await getStoreSummary(client.page)).tasks;
          const undone = tasks.filter(
            (t) => t.title.includes(parentName) && !t.isDone && !t.parentId,
          );
          const spent = await readTimeSpent(client.page, instanceId);
          console.log(
            `[11645] client ${name}: undone instances=${undone.length}, timeSpent(${instanceId})=${spent}`,
          );
          expect(undone, `client ${name}: one undone instance`).toHaveLength(1);
          const dueWithTime = await readTaskNumber(
            client.page,
            instanceId,
            'dueWithTime',
          );
          expect(
            dueWithTime > 0,
            `client ${name}: instance is timed iff the series is`,
          ).toBe(!!startTime);
          expect(
            spent,
            `client ${name}: time tracked on A must survive B's concurrent create`,
          ).toBe(TRACKED_MS);
        }
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});
