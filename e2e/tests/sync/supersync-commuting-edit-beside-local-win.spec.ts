import type { Browser } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  recordTaskTimeDelta,
  getTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { TagPage } from '../../pages/tag.page';

/**
 * Since #10252 (unreleased), a remote edit that touches other fields than a
 * pending task time delta commutes with it (`isCommutingTimeDeltaCrossing`)
 * and is applied without a conflict.
 *
 * Here one download brings two remote ops for the same task: a notes edit
 * that commutes with the pending ops, and a done toggle that conflicts with
 * the local one and loses by LWW. The local side builds its whole-task
 * `[TASK] LWW Update` from the state before the notes edit is applied, then
 * applies the notes edit. B keeps A's notes, but the replace-mode snapshot it
 * uploads has none, and A drops its own notes.
 *
 * Before the fix, A's notes were gone on A only (#10385). The local-win
 * snapshot now carries the readable fields of the same batch's nonconflicting
 * ops (`buildTimeAwareResolutionBatches`). The second test is the other
 * conflict direction: A's done toggle is the later one, so B's loses. The sync
 * fuzz harness pins the same trace (sync-fuzz-pinned-traces.json, class
 * commuting-edit-beside-local-win).
 */

/** Only explicit syncs run, so every crossing happens in the stated order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

/** Fail on the dataset conflict dialog or an error instead of resolving it. */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  const outcome = async (): Promise<string> => {
    if (await client.sync.conflictDialog.isVisible()) return 'conflict-dialog';
    if (await client.sync.hasSyncError()) return 'error';
    const spinning = await client.sync.syncSpinner.isVisible();
    const checked = await client.sync.syncCheckIcon
      .filter({ hasText: /^done_all$/ })
      .isVisible();
    return !spinning && checked ? 'in-sync' : 'pending';
  };
  let observed = 'pending';
  await expect
    .poll(
      async () => {
        observed = await outcome();
        return observed;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(observed).toBe('in-sync');
};

/** Records each client's full-state upload, e.g. after repairing invalid state. */
const recordFullStateUploads = (clients: SimulatedE2EClient[]): string[] => {
  const uploads: string[] = [];
  for (const client of clients) {
    client.page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/sync/snapshot')) {
        uploads.push(client.clientName);
      }
    });
  }
  return uploads;
};

interface TaskView {
  notes: string | null;
  isDone: boolean;
  timeSpent: number;
  timeEstimate: number;
  tagIds: string[];
}

/**
 * Applies field changes (notes, estimate) through the store with the action
 * the task editors dispatch (`TaskService.update`), or only reads; returns
 * what the device holds afterwards.
 */
const onTask = async (
  client: SimulatedE2EClient,
  taskName: string,
  changes?: Record<string, unknown>,
): Promise<TaskView> =>
  client.page.evaluate(
    async ({ name, newChanges }) => {
      type Subscription = { unsubscribe: () => void };
      type StoreLike = {
        subscribe: (next: (state: unknown) => void) => Subscription;
        dispatch: (action: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }
      const readTask = (): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const ref: { current?: Subscription } = {};
          ref.current = store.subscribe((state) => {
            window.setTimeout(() => ref.current?.unsubscribe());
            const root = state as Record<string, { entities?: Record<string, unknown> }>;
            const entities = (root.tasks ?? root.task)?.entities ?? {};
            const task = Object.values(entities).find(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                String((value as Record<string, unknown>).title).includes(name),
            );
            if (task) {
              resolve(task as Record<string, unknown>);
            } else {
              reject(new Error(`Task not found: ${name}`));
            }
          });
        });
      if (newChanges !== undefined) {
        const task = await readTask();
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: newChanges },
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: task.id,
            opType: 'UPD',
          },
        });
      }
      const current = await readTask();
      return {
        notes: typeof current.notes === 'string' ? current.notes : null,
        isDone: current.isDone === true,
        timeSpent: typeof current.timeSpent === 'number' ? current.timeSpent : 0,
        timeEstimate: typeof current.timeEstimate === 'number' ? current.timeEstimate : 0,
        tagIds: [...((current.tagIds as string[] | undefined) ?? [])],
      };
    },
    { name: taskName, newChanges: changes },
  );

test.describe('@supersync remote edit beside a local LWW win', () => {
  /**
   * A writes notes and a done toggle; B, not synced since the task arrived,
   * tracks time (a pending delta) and marks the task done. `bWins` decides
   * whose done toggle is later and so wins LWW.
   * - Default order (#10385): A uploads the notes edit, then the done toggle.
   * - `between`: A marks the task done, then writes the task another way,
   *   then edits the notes, all uploaded together. The snapshot does not
   *   carry that write, so it must not claim it (review of #10398):
   *   - `'estimate'`: an estimate edit, which commutes with B's delta too;
   *   - `'tagDeletion'`: deleting a tag the task has, which declares only the
   *     tag, so nothing on the task names the write.
   */
  const runCrossing = async (
    {
      browser,
      baseURL,
      testRunId,
    }: { browser: Browser; baseURL?: string; testRunId: string },
    bWins: boolean,
    between?: 'estimate' | 'tagDeletion',
  ): Promise<void> => {
    const taskName = `NotesBesideLocalWin-${Date.now()}`;
    const notes = 'Notes written on A';
    const trackedOnB = 60000;
    const estimate = between === 'estimate' ? 3600000 : 0;
    const tagName = `BesideLocalWinTag-${Date.now()}`;
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      const tagPageA = new TagPage(clientA.page);
      if (between === 'tagDeletion') {
        await tagPageA.createTag(tagName);
        await tagPageA.assignTagToTask(
          getTaskElement(clientA, taskName).first(),
          tagName,
        );
      }
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      const { tagIds } = await onTask(clientB, taskName);
      expect(tagIds.length).toBe(between === 'tagDeletion' ? 1 : 0);

      for (const client of clients) {
        await blockBackgroundSync(client);
      }
      const fullStateUploads = recordFullStateUploads(clients);

      const trackAndMarkDoneOnB = async (): Promise<void> => {
        await recordTaskTimeDelta(clientB, taskName, '2026-07-13', trackedOnB);
        await markTaskDone(clientB, taskName);
        expect(await onTask(clientB, taskName)).toEqual({
          notes: null,
          isDone: true,
          timeSpent: trackedOnB,
          timeEstimate: 0,
          tagIds,
        });
      };

      // B's done toggle is the earlier one when A should win.
      if (!bWins) {
        await trackAndMarkDoneOnB();
      }

      if (between) {
        // Done toggle first, then the other write and the notes edit, in one upload.
        await markTaskDone(clientA, taskName);
        if (bWins) {
          await trackAndMarkDoneOnB();
        }
        if (between === 'estimate') {
          await onTask(clientA, taskName, { timeEstimate: estimate });
        } else {
          await tagPageA.deleteTag(tagName);
        }
        expect(await onTask(clientA, taskName, { notes })).toEqual({
          notes,
          isDone: true,
          timeSpent: 0,
          timeEstimate: estimate,
          tagIds: [],
        });
        await sync(clientA);
      } else {
        // A uploads its notes edit, then its done toggle: B downloads both at once.
        expect(await onTask(clientA, taskName, { notes })).toEqual({
          notes,
          isDone: false,
          timeSpent: 0,
          timeEstimate: 0,
          tagIds: [],
        });
        await sync(clientA);
        await markTaskDone(clientA, taskName);
        await sync(clientA);
        if (bWins) {
          await trackAndMarkDoneOnB();
        }
      }

      await sync(clientB);
      await sync(clientA);
      await sync(clientB);

      // Both devices, in one assertion, so a failure shows the divergence.
      // When B loses, it rejects every pending op of the task, its time delta
      // included, which then never uploads (#10260, also on master before
      // this fix); only the fields this fix covers are compared then.
      const view = async (client: SimulatedE2EClient): Promise<Partial<TaskView>> => {
        const { timeSpent, ...task } = await onTask(client, taskName);
        return bWins ? { ...task, timeSpent } : task;
      };
      const expected = bWins
        ? {
            notes,
            isDone: true,
            timeSpent: trackedOnB,
            timeEstimate: estimate,
            tagIds: [],
          }
        : { notes, isDone: true, timeEstimate: estimate, tagIds: [] };
      await expect
        .poll(async () => ({ A: await view(clientA), B: await view(clientB) }), {
          timeout: 30000,
        })
        .toEqual({ A: expected, B: expected });
      // No device had to repair state it found invalid (a deleted tag's id).
      expect(fullStateUploads).toEqual([]);
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  };

  test('a notes edit that commutes with a pending time delta survives a same-batch local win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, true);
  });

  test('a notes edit that commutes with a pending time delta survives a same-batch remote win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, false);
  });

  test('an estimate edit between the local win and the notes edit survives a local win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, true, 'estimate');
  });

  test('an estimate edit between the remote win and the notes edit survives a remote win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, false, 'estimate');
  });

  test('a tag deletion between the local win and the notes edit survives a local win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, true, 'tagDeletion');
  });
});
