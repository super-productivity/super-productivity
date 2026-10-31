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
  saveRecurDialog,
  setRecurSkipOverdue,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/10958
 *
 * Device A (desktop) enables "Don't let overdue instances pile up"
 * (`skipOverdue`) on a recurring task. Device B (Android) opens on a new day:
 * its repeat generation dispatches `updateTaskRepeatCfg` with only
 * `lastTaskCreation`/`lastTaskCreationDay` before it downloads A's edit, so the
 * two edits of the config are concurrent. After both sync, the option must
 * still be enabled on both devices.
 *
 * Why it happened: TASK_REPEAT_CFG had no RECREATE_FALLBACK entry, so the
 * disjoint crossing was refused a field patch and fell back to whole-entity
 * LWW. When B's generation was the later write, its replace snapshot carried
 * B's stale `skipOverdue: false` to every device.
 *
 * Both conflict directions (which device resolves) and both timestamp
 * winners (whose config write is later) are covered.
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

/** Sync once; fail on the dataset conflict dialog or a sync error. */
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
    const checked = await client.sync.syncConfirmedIcon.isVisible();
    // The skipOverdue reaper (TaskRepeatCleanupEffects) may queue a local
    // deleteTasks right after a sync that delivered `skipOverdue: true`, so a
    // settled sync without the confirmed icon is accepted too.
    return !spinning && checked ? 'in-sync' : !spinning ? 'settled' : 'pending';
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
  expect(['in-sync', 'settled']).toContain(observed);
};

interface RepeatCfgView {
  skipOverdue: boolean | null;
  lastTaskCreationDay: string | null;
}

/** The repeat config whose title contains `title`, read from the live store. */
const getRepeatCfg = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<RepeatCfgView | null> =>
  client.page.evaluate((name: string) => {
    type CfgLike = {
      title?: string | null;
      skipOverdue?: boolean;
      lastTaskCreationDay?: string;
    };
    type StoreState = {
      taskRepeatCfg?: { entities?: Record<string, CfgLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (s: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let latest: StoreState | undefined;
    store
      .subscribe((s) => {
        latest = s;
      })
      .unsubscribe();
    const cfg = Object.values(latest?.taskRepeatCfg?.entities ?? {}).find((c) =>
      c?.title?.includes(name),
    );
    return cfg
      ? {
          skipOverdue: cfg.skipOverdue ?? null,
          lastTaskCreationDay: cfg.lastTaskCreationDay ?? null,
        }
      : null;
  }, title);

/** Open the task's detail panel from its hover toolbar. */
const openTaskDetail = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = client.page.locator(`task:not(.isDone):has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });
  await task.locator('.first-line').first().hover();
  const showDetailBtn = client.page.getByRole('button', {
    name: 'Show/hide task panel',
  });
  await showDetailBtn.waitFor({ state: 'visible', timeout: 5000 });
  await showDetailBtn.click();
  await client.page.waitForTimeout(300);
};

/** Open the repeat dialog for the task, set skipOverdue, save. */
const editSkipOverdue = async (
  client: SimulatedE2EClient,
  taskName: string,
  isChecked: boolean,
): Promise<void> => {
  await openTaskDetail(client, taskName);
  await openRecurDialog(client.page);
  await setRecurSkipOverdue(client.page, isChecked);
  await saveRecurDialog(client.page);
  await client.page.keyboard.press('Escape');
};

/**
 * Move a device's clock to `isoTime` (a later day) and let its day-change
 * handling run the repeat generation. setSystemTime (not setFixedTime) keeps
 * Date.now() advancing for the debounced day-change chain (#6230).
 */
const crossDay = async (
  client: SimulatedE2EClient,
  title: string,
  isoTime: string,
): Promise<void> => {
  await client.page.clock.setSystemTime(new Date(isoTime));
  await client.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const day = isoTime.slice(0, 10);
  await expect
    .poll(async () => (await getRepeatCfg(client, title))?.lastTaskCreationDay, {
      timeout: 60000,
    })
    .toBe(day);
};

test.describe('@supersync Recurring skipOverdue survives a concurrent repeat generation (#10958)', () => {
  const runScenario = async (
    {
      browser,
      baseURL,
      testRunId,
    }: {
      browser: Parameters<typeof createSimulatedClient>[0];
      baseURL?: string;
      testRunId: string;
    },
    resolver: 'A' | 'B',
    laterWriter: 'A' | 'B',
  ): Promise<void> => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const title = `SkipOverdue-${resolver}${laterWriter}-${testRunId}`;

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      for (const client of [clientA, clientB]) {
        await client.page.clock.setSystemTime(new Date('2026-06-15T15:00:00'));
        await client.page.reload();
        await client.workView.waitForTaskList();
      }
      await clientA.sync.setupSuperSync(syncConfig);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. A creates a daily recurring task with skipOverdue OFF.
      await clientA.workView.addTask(title);
      await waitForTask(clientA.page, title);
      await editSkipOverdue(clientA, title, false);
      await expect
        .poll(async () => (await getRepeatCfg(clientA!, title))?.skipOverdue)
        .toBe(false);

      // 2. Both devices agree on the config.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect
        .poll(async () => await getRepeatCfg(clientB!, title))
        .toEqual({ skipOverdue: false, lastTaskCreationDay: '2026-06-15' });

      for (const client of [clientA, clientB]) {
        await blockBackgroundSync(client);
      }

      // 3. Concurrent config writes: A enables skipOverdue, B's repeat
      //    generation on the next day advances lastTaskCreationDay.
      if (laterWriter === 'B') {
        await editSkipOverdue(clientA, title, true);
        await crossDay(clientB, title, '2026-06-16T00:05:00');
      } else {
        await crossDay(clientB, title, '2026-06-16T00:05:00');
        await crossDay(clientA, title, '2026-06-16T09:00:00');
        await editSkipOverdue(clientA, title, true);
      }
      expect((await getRepeatCfg(clientA, title))?.skipOverdue).toBe(true);
      expect((await getRepeatCfg(clientB, title))?.skipOverdue).toBe(false);

      // 4. Converge; `resolver` downloads the other side's write while its
      //    own is pending.
      const [first, second] = resolver === 'B' ? [clientA, clientB] : [clientB, clientA];
      await sync(first);
      await sync(second);
      await sync(first);

      // 5. The option stays enabled everywhere (#10958).
      for (const client of [clientA, clientB]) {
        await expect
          .poll(async () => await getRepeatCfg(client, title), {
            timeout: 10000,
            message: `client ${client.clientName}`,
          })
          .toEqual({ skipOverdue: true, lastTaskCreationDay: '2026-06-16' });
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  };

  for (const resolver of ['B', 'A'] as const) {
    for (const laterWriter of ['B', 'A'] as const) {
      test(`skipOverdue stays enabled (resolver ${resolver}, later write ${laterWriter})`, async ({
        browser,
        baseURL,
        testRunId,
      }) => {
        await runScenario({ browser, baseURL, testRunId }, resolver, laterWriter);
      });
    }
  }
});
