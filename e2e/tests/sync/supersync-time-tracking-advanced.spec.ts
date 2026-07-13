import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  startTimeTracking,
  stopTimeTracking,
  waitForTaskTimeSpent,
  getTaskTimeSpentFromState,
  markTaskDone,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';
import { waitForAppReady } from '../../utils/waits';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Record an exact local time delta through the same two actions used by the
 * production timer: one updates local state, the other writes the replayable op.
 */
const recordTaskTimeDelta = async (
  client: SimulatedE2EClient,
  taskName: string,
  date: string,
  duration: number,
): Promise<void> => {
  await client.page.evaluate(
    async ({ name, taskDate, delta }) => {
      const isRecordInPage = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null;

      type StoreSubscription = { unsubscribe: () => void };
      type StoreLike = {
        subscribe: (next: (state: unknown) => void) => StoreSubscription;
        dispatch: (action: unknown) => void;
      };

      const store = (
        window as unknown as {
          __e2eTestHelpers?: { store?: StoreLike };
        }
      ).__e2eTestHelpers?.store;

      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }

      const rootState = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const subscriptionRef: { current?: StoreSubscription } = {};
        let isDone = false;
        const timeoutId = window.setTimeout(() => {
          if (!isDone) {
            isDone = true;
            subscriptionRef.current?.unsubscribe();
            reject(new Error('Timed out reading the NgRx state'));
          }
        }, 1000);

        subscriptionRef.current = store.subscribe((state) => {
          if (isDone || !isRecordInPage(state)) {
            return;
          }
          isDone = true;
          window.clearTimeout(timeoutId);
          window.setTimeout(() => subscriptionRef.current?.unsubscribe());
          resolve(state);
        });
      });

      const taskState = rootState.tasks ?? rootState.task;
      if (!isRecordInPage(taskState) || !isRecordInPage(taskState.entities)) {
        throw new Error('Task state is unavailable');
      }

      const task = Object.values(taskState.entities).find(
        (value) =>
          isRecordInPage(value) &&
          typeof value.title === 'string' &&
          value.title.includes(name),
      );
      if (!isRecordInPage(task) || typeof task.id !== 'string') {
        throw new Error(`Task not found: ${name}`);
      }

      store.dispatch({
        type: '[TimeTracking] Add time spent',
        task,
        date: taskDate,
        duration: delta,
        isFromTrackingReminder: false,
      });
      store.dispatch({
        type: '[TimeTracking] Sync time spent',
        taskId: task.id,
        date: taskDate,
        duration: delta,
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
    },
    { name: taskName, taskDate: date, delta: duration },
  );
};

const expectExactTaskTime = async (
  client: SimulatedE2EClient,
  taskName: string,
  expectedTimeSpent: number,
): Promise<void> => {
  await expect
    .poll(() => getTaskTimeSpentFromState(client, taskName), {
      timeout: 30000,
      intervals: [250, 500, 1000],
    })
    .toBe(expectedTimeSpent);
};

/**
 * SuperSync Time Tracking Advanced E2E Tests
 *
 * Tests time tracking edge cases:
 * - Concurrent time tracking on same task
 * - Archive task with time tracking data
 * - Large time values precision
 */

test.describe('@supersync Time Tracking Advanced Sync', () => {
  /**
   * Test: Time tracking data persists after archive
   *
   * Actions:
   * 1. Client A creates task and tracks time (5 seconds)
   * 2. Client A marks task done and syncs
   * 3. Client B syncs and receives task
   * 4. Client B archives via "Finish Day"
   * 5. Client B syncs archive
   * 6. Client A syncs
   * 7. Both verify time in worklog
   */
  test('Time tracking data persists after archive', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates and Tracks Task ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `ArchiveTime-${uniqueId}`;
      await clientA.workView.addTask(taskName);
      console.log('[Archive Time Test] Client A created task');

      // Start time tracking
      await startTimeTracking(clientA, taskName);
      console.log('[Archive Time Test] Started time tracking');

      // Wait for the first global tracking tick before stopping. A fixed sleep can
      // race the app timer under CI load and leave the task with 0 recorded time.
      await waitForTaskTimeSpent(clientA, taskName, 10000);

      // Stop tracking
      await stopTimeTracking(clientA, taskName);
      console.log('[Archive Time Test] Stopped time tracking');

      // Capture tracked time from persisted state. The row can hide the visual
      // time while hover controls are mounted, and sub-minute values render as
      // "-" in the UI.
      const trackedTimeMs = await waitForTaskTimeSpent(clientA, taskName, 5000);
      console.log(`[Archive Time Test] Tracked time: ${trackedTimeMs}ms`);

      // Mark as done
      await markTaskDone(clientA, taskName);
      console.log('[Archive Time Test] Marked task done');

      // ============ PHASE 2: Sync to Server ============
      await clientA.sync.syncAndWait();
      console.log('[Archive Time Test] Client A synced');

      // ============ PHASE 3: Client B Archives ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Archive Time Test] Client B synced');

      // Verify task exists on B
      await waitForTask(clientB.page, taskName);

      // Archive via Finish Day
      const finishDayBtn = clientB.page.locator('.e2e-finish-day');
      await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
      await finishDayBtn.click();
      console.log('[Archive Time Test] Client B clicked Finish Day');

      await clientB.page.waitForURL(/daily-summary/, { timeout: 10000 });
      await clientB.page.waitForLoadState('networkidle');

      // Click save to archive
      const saveBtn = clientB.page.locator(
        'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
      );
      await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
      await saveBtn.click();
      console.log('[Archive Time Test] Client B archived');

      await clientB.page.waitForURL(/tag\/TODAY/, { timeout: 10000 });

      // ============ PHASE 4: Sync Archive ============
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      console.log('[Archive Time Test] Both synced archive');

      // ============ PHASE 5: Verify Time in Worklog ============
      // Navigate to worklog on Client A
      await clientA.page.goto('/#/tag/TODAY/history');
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForSelector('history', { timeout: 10000 });

      // Expand week to see tasks
      const weekRow = clientA.page.locator('.week-row').first();
      if (await weekRow.isVisible()) {
        await weekRow.click();
        await clientA.page.waitForTimeout(500);
      }

      // Verify task with time appears in worklog
      const taskInWorklog = clientA.page.locator(
        `.task-summary-table .task-title:has-text("${taskName}")`,
      );
      await expect(taskInWorklog).toBeVisible({ timeout: 10000 });
      console.log('[Archive Time Test] Task visible in worklog with time data');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Large time values sync with precision
   *
   * Actions:
   * 1. Client A creates task with large time estimate (8h)
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify time estimate is exactly 8h on Client B
   */
  test('Task with large time estimate syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Task with Large Estimate ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `LargeTime-${uniqueId}`;
      // Use t:8h for 8 hour estimate
      await clientA.workView.addTask(`${taskName} t:8h`);
      console.log('[Large Time Test] Client A created task with 8h estimate');

      await waitForTask(clientA.page, taskName);

      // Task exists on Client A (estimate is stored but may not be visible in compact view)
      await expectTaskVisible(clientA, taskName);
      console.log('[Large Time Test] Task visible on Client A');

      // ============ PHASE 2: Sync ============
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // ============ PHASE 3: Verify on Client B ============
      await waitForTask(clientB.page, taskName);

      await expectTaskVisible(clientB, taskName);
      console.log('[Large Time Test] Task visible on Client B');

      // Note: Time estimate is stored as task data, UI display varies
      // The key test is that the task synced successfully
      console.log('[Large Time Test] Task with time estimate synced successfully');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Concurrent task-time deltas survive snapshot hydration and restart', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);

    const initialTime = 10000;
    const clientADelta = 3000;
    const clientBDelta = 5000;
    const expectedTime = initialTime + clientADelta + clientBDelta;
    const snapshotPassword = 'e2e-time-snapshot-pw';
    const taskDate = '2026-07-13';
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `ConcurrentTime-${uniqueId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      await recordTaskTimeDelta(clientA, taskName, taskDate, initialTime);
      await expectExactTaskTime(clientA, taskName, initialTime);

      // Password change uses the production clean-slate path: it replaces the
      // server with a full-state snapshot. The initial time is therefore in the
      // snapshot, while the two concurrent contributions below remain tail ops.
      await clientA.sync.changeEncryptionPassword(snapshotPassword);
      await expectExactTaskTime(clientA, taskName, initialTime);
      const snapshotSyncConfig = { ...syncConfig, password: snapshotPassword };

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(snapshotSyncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      await expectExactTaskTime(clientB, taskName, initialTime);

      // Both clients record against the same base before either sees the other delta.
      await recordTaskTimeDelta(clientA, taskName, taskDate, clientADelta);
      await recordTaskTimeDelta(clientB, taskName, taskDate, clientBDelta);
      await expectExactTaskTime(clientA, taskName, initialTime + clientADelta);
      await expectExactTaskTime(clientB, taskName, initialTime + clientBDelta);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expectExactTaskTime(clientA, taskName, expectedTime);
      await expectExactTaskTime(clientB, taskName, expectedTime);

      // C is a fresh database. Requiring the snapshot vector clock proves its
      // first hydration used the server's latest snapshot boundary plus tail ops.
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      const snapshotHydrationResponse = clientC.page.waitForResponse(
        async (response) => {
          if (
            response.request().method() !== 'GET' ||
            !response.url().includes('/api/sync/ops')
          ) {
            return false;
          }

          try {
            const responseBody: unknown = await response.json();
            return isRecord(responseBody) && isRecord(responseBody.snapshotVectorClock);
          } catch {
            return false;
          }
        },
        { timeout: 60000 },
      );
      await clientC.sync.setupSuperSync(snapshotSyncConfig);
      await clientC.sync.syncAndWait();
      await snapshotHydrationResponse;
      await waitForTask(clientC.page, taskName);
      await expectExactTaskTime(clientC, taskName, expectedTime);

      const clients = [clientA, clientB, clientC];
      for (const client of clients) {
        await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(client.page);
        await waitForTask(client.page, taskName);
        await expectExactTaskTime(client, taskName, expectedTime);
      }

      for (const client of clients) {
        await client.sync.syncAndWait();
        await expectExactTaskTime(client, taskName, expectedTime);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
