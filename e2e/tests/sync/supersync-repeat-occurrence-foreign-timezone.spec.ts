import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getTaskElement,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import type { Page } from '@playwright/test';
import {
  openRecurDialog,
  saveRecurDialog,
  setRecurSkipOverdue,
} from '../../utils/recurring-task-helpers';
import { blockBackgroundSync } from '../../utils/time-preserving-resolution-helpers';
import { waitForAppReady } from '../../utils/waits';

type RepeatState = {
  instanceIds: string[];
  legacyInstanceCount: number;
  lastCreationDays: string[];
};
const readRepeatState = (page: Page): Promise<RepeatState> =>
  page.evaluate(async () => {
    type State = {
      tasks: {
        ids: string[];
        entities: Record<string, { repeatCfgId?: string; parentId?: string }>;
      };
      taskRepeatCfg: { entities: Record<string, { lastTaskCreationDay?: string }> };
    };
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (cb: (state: State) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    return new Promise<RepeatState>((resolve) => {
      const subscription = store.subscribe((state) => {
        window.setTimeout(() => subscription.unsubscribe());
        resolve({
          // Same config, so sorting orders the instances by day.
          instanceIds: state.tasks.ids.filter((id) => id.startsWith('rpt_')).sort(),
          // The task made repeatable keeps its random id.
          legacyInstanceCount: state.tasks.ids.filter((id) => {
            const task = state.tasks.entities[id];
            return !!task.repeatCfgId && !task.parentId && !id.startsWith('rpt_');
          }).length,
          lastCreationDays: Object.values(state.taskRepeatCfg.entities).map(
            (cfg) => cfg.lastTaskCreationDay ?? '',
          ),
        });
      });
    });
  });

// A repeat instance is created at noon of its day in the creating timezone.
// A's June 16 instance (Los Angeles) reads as June 17 on B (Tokyo), so B used to
// count its own June 17 occurrence as created, advance the config's creation day
// and never create it. "Keep every copy" keeps the overdue instances, so the
// duplicate cleanup must not take one occurrence for another either: the task
// made repeatable on June 15 keeps its random id and reads as June 16 on B.
test.describe('@supersync Repeat occurrence from a device in another timezone', () => {
  test('a device a day ahead still creates its own occurrence', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const taskName = `DailyRepeat-${testRunId}`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      for (const [name, timezoneId, now] of [
        // June 15, 12:00 in Los Angeles.
        ['A', 'America/Los_Angeles', '2026-06-15T19:00:00Z'],
        // June 17, 04:00 in Tokyo; June 16, 12:00 in Los Angeles.
        ['B', 'Asia/Tokyo', '2026-06-16T19:00:00Z'],
      ] as const) {
        const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
        clients.push(client);
        const cdp = await client.context.newCDPSession(client.page);
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId });
        // setSystemTime keeps the clock moving, as the day-change effect needs (#6230).
        await client.page.clock.setSystemTime(new Date(now));
        await client.page.reload();
        await client.workView.waitForTaskList();
        await client.page.evaluate(blockBackgroundSync);
        await client.page.addInitScript(blockBackgroundSync);
        await client.sync.setupSuperSync(config);
      }
      const [a, b] = clients;

      await a.workView.addTask(taskName);
      const task = getTaskElement(a, taskName).first();
      await task.hover();
      await a.page.getByRole('button', { name: 'Show/hide task panel' }).click();
      await openRecurDialog(a.page);
      await setRecurSkipOverdue(a.page, false);
      await saveRecurDialog(a.page);
      await a.page.keyboard.press('Escape');
      // June 16 in Los Angeles: A creates the June 16 occurrence.
      await a.page.clock.setSystemTime(new Date('2026-06-16T19:00:00Z'));
      await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect
        .poll(async () => (await readRepeatState(a.page)).instanceIds, {
          timeout: 60000,
        })
        .toEqual([expect.stringMatching(/_2026-06-16$/)]);
      await a.sync.syncAndWait();

      await b.sync.syncAndWait();
      await waitForTask(b.page, taskName);
      // The restart runs the ordinary startup creation with the synced config.
      await b.page.reload();
      await waitForAppReady(b.page);
      await b.sync.syncAndWait();
      await expect
        .poll(async () => (await readRepeatState(b.page)).lastCreationDays, {
          timeout: 60000,
        })
        .toEqual(['2026-06-17']);
      await b.sync.syncAndWait();
      await a.sync.syncAndWait();

      for (const client of clients) {
        await expect
          .poll(
            async () => {
              const { instanceIds, legacyInstanceCount } = await readRepeatState(
                client.page,
              );
              return { instanceIds, legacyInstanceCount };
            },
            { timeout: 30000 },
          )
          .toEqual({
            instanceIds: [
              expect.stringMatching(/_2026-06-16$/),
              expect.stringMatching(/_2026-06-17$/),
            ],
            legacyInstanceCount: 1,
          });
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
