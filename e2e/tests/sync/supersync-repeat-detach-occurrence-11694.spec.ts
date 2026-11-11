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
  getRepeatSeriesView,
  gotoHashRoute,
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
  type RepeatSeriesView,
} from '../../utils/recurring-task-helpers';
import { blockBackgroundSync } from '../../utils/time-preserving-resolution-helpers';
import { TaskPage } from '../../pages/task.page';

/**
 * https://github.com/super-productivity/super-productivity/issues/11694
 *
 * "Separate task for <date>" turns one projected occurrence of a recurring
 * task into a normal task. It writes two existing ops, skip first:
 * `updateTaskRepeatCfg` with the new `deletedInstanceDates`, then `addTask`.
 *
 * After both devices sync, the day is skipped on both and each holds the same
 * single unlinked task for it; when the day arrives, neither device's own
 * repeat generation adds a series instance next to it.
 *
 * The concurrent case: device B edits the repeat rule (Daily to Monday through
 * Friday, the detached Tuesday stays an occurrence) before it has seen A's
 * detach. Both conflict directions (which device resolves) and both timestamp
 * winners (whose config write is later) are covered.
 */

const START = '2026-06-15T15:00:00'; // a Monday
const DETACHED_DAY = '2026-06-16';
const FOLLOWING_DAY = '2026-06-17';
const UNLINKED = { dueDay: DETACHED_DAY, repeatCfgId: null, isSeriesId: false };

type Fixtures = {
  browser: Parameters<typeof createSimulatedClient>[0];
  baseURL?: string;
  testRunId: string;
};

/** The tasks of the series title that are due on `day`. */
const dueOn = (
  view: RepeatSeriesView,
  day: string,
): { dueDay: string | null; repeatCfgId: string | null; isSeriesId: boolean }[] =>
  view.tasks
    .filter((task) => task.dueDay === day)
    .map((task) => ({
      dueDay: task.dueDay,
      repeatCfgId: task.repeatCfgId,
      isSeriesId: task.id.startsWith('rpt_'),
    }));

const openRepeatDialogOfTask = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  const task = client.page.locator(`task:not(.isDone):has-text("${title}")`).first();
  await new TaskPage(client.page).openTaskDetail(task);
  await openRecurDialog(client.page);
};

const makeDaily = async (client: SimulatedE2EClient, title: string): Promise<void> => {
  await client.workView.addTask(title);
  await waitForTask(client.page, title);
  await openRepeatDialogOfTask(client, title);
  await saveRecurDialog(client.page);
  await client.page.keyboard.press('Escape');
};

const editRuleToWeekdays = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  await openRepeatDialogOfTask(client, title);
  await setRecurQuickSetting(client.page, /Every Monday through Friday/i);
  await saveRecurDialog(client.page);
  await client.page.keyboard.press('Escape');
  await expect
    .poll(async () => (await getRepeatSeriesView(client.page, title)).cfg?.quickSetting)
    .toBe('MONDAY_TO_FRIDAY');
};

const detachOccurrence = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  const projection = client.page
    .locator(`planner-day[data-day="${DETACHED_DAY}"] planner-repeat-projection`)
    .filter({ hasText: title });
  await gotoHashRoute(client.page, '/#/planner', projection.first());
  await projection.click();
  const dialog = client.page.locator('mat-dialog-container');
  await dialog
    .getByRole('button', { name: 'Separate task for 16/06', exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 10000 });
  await expect
    .poll(async () => dueOn(await getRepeatSeriesView(client.page, title), DETACHED_DAY))
    .toEqual([UNLINKED]);
};

/**
 * Move a device's clock to `isoTime` (a later day) and let its day-change
 * handling run the repeat generation; the control series' cursor reaching that
 * day shows it ran (a skipped day leaves the cursor of its own series alone).
 * setSystemTime (not setFixedTime) keeps Date.now() advancing for the
 * debounced day-change chain (#6230).
 */
const crossDay = async (
  client: SimulatedE2EClient,
  controlTitle: string,
  isoTime: string,
): Promise<void> => {
  await client.page.clock.setSystemTime(new Date(isoTime));
  await client.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(
      async () =>
        (await getRepeatSeriesView(client.page, controlTitle)).cfg?.lastTaskCreationDay,
      { timeout: 60000 },
    )
    .toBe(isoTime.slice(0, 10));
};

const runScenario = async (
  { browser, baseURL, testRunId }: Fixtures,
  concurrentRuleEdit?: { resolver: 'A' | 'B'; laterWriter: 'A' | 'B' },
): Promise<void> => {
  let clientA: SimulatedE2EClient | null = null;
  let clientB: SimulatedE2EClient | null = null;
  try {
    const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
    const suffix = concurrentRuleEdit
      ? `${concurrentRuleEdit.resolver}${concurrentRuleEdit.laterWriter}`
      : 'plain';
    const title = `Detach-${suffix}-${testRunId}`;
    const controlTitle = `Control-${suffix}-${testRunId}`;

    clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
    const a = clientA;
    const b = clientB;
    for (const client of [a, b]) {
      await client.page.clock.setSystemTime(new Date(START));
      await client.page.reload();
      await client.workView.waitForTaskList();
    }
    await a.sync.setupSuperSync(syncConfig);
    await b.sync.setupSuperSync(syncConfig);

    // 1. A creates the daily series (and a control series); both devices agree.
    await makeDaily(a, title);
    await makeDaily(a, controlTitle);
    await a.sync.syncAndWait();
    await b.sync.syncAndWait();
    await waitForTask(b.page, title);
    for (const client of [a, b]) {
      await client.page.evaluate(blockBackgroundSync);
    }

    // 2. A detaches Tuesday; in the concurrent case B edits the rule unseen.
    const writes: Record<'A' | 'B', () => Promise<void>> = {
      A: () => detachOccurrence(a, title),
      B: () => editRuleToWeekdays(b, title),
    };
    if (concurrentRuleEdit) {
      const { laterWriter } = concurrentRuleEdit;
      const earlierWriter = laterWriter === 'A' ? 'B' : 'A';
      await writes[earlierWriter]();
      const later = laterWriter === 'A' ? a : b;
      await later.page.clock.setSystemTime(new Date('2026-06-15T18:00:00'));
      await writes[laterWriter]();
    } else {
      await writes.A();
    }

    // 3. Converge; `resolver` downloads the other side's write while its own
    //    is pending.
    const [first, second] = concurrentRuleEdit?.resolver === 'A' ? [b, a] : [a, b];
    const converge = async (): Promise<void> => {
      await first.sync.syncAndWait();
      await second.sync.syncAndWait();
      await first.sync.syncAndWait();
    };
    await converge();

    const expectSkippedWithOneTask = async (step: string): Promise<void> => {
      const views: RepeatSeriesView[] = [];
      for (const client of [a, b]) {
        const message = `${step}, client ${client.clientName}`;
        await expect
          .poll(
            async () =>
              (await getRepeatSeriesView(client.page, title)).cfg?.deletedInstanceDates,
            { timeout: 10000, message },
          )
          .toEqual([DETACHED_DAY]);
        const view = await getRepeatSeriesView(client.page, title);
        expect(dueOn(view, DETACHED_DAY), message).toEqual([UNLINKED]);
        if (concurrentRuleEdit) {
          expect(view.cfg?.quickSetting, message).toBe('MONDAY_TO_FRIDAY');
        }
        views.push(view);
      }
      // Same tasks under the same ids, so the detached task is one task.
      expect(views[0].tasks, step).toEqual(views[1].tasks);
    };
    await expectSkippedWithOneTask('after the detach synced');

    // 4. Tuesday arrives; each device runs its own repeat generation first.
    await crossDay(a, controlTitle, '2026-06-16T00:05:00');
    await crossDay(b, controlTitle, '2026-06-16T09:00:00');
    await converge();
    await expectSkippedWithOneTask('on the detached day');

    // 5. The series resumes on Wednesday, once.
    await crossDay(a, controlTitle, '2026-06-17T00:05:00');
    await crossDay(b, controlTitle, '2026-06-17T09:00:00');
    await converge();
    for (const client of [a, b]) {
      await expect
        .poll(
          async () => dueOn(await getRepeatSeriesView(client.page, title), FOLLOWING_DAY),
          { timeout: 10000, message: `client ${client.clientName}` },
        )
        .toEqual([
          { dueDay: FOLLOWING_DAY, repeatCfgId: expect.any(String), isSeriesId: true },
        ]);
    }
    await expectSkippedWithOneTask('the day after');
  } finally {
    if (clientA) await closeClient(clientA);
    if (clientB) await closeClient(clientB);
  }
};

test.describe('@supersync Detach one recurring occurrence (#11694)', () => {
  test('detached occurrence converges: skipped on both devices, one normal task, no duplicate on the day', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    await runScenario({ browser, baseURL, testRunId });
  });

  for (const resolver of ['B', 'A'] as const) {
    for (const laterWriter of ['B', 'A'] as const) {
      test(`detached occurrence survives a concurrent rule edit (resolver ${resolver}, later write ${laterWriter})`, async ({
        browser,
        baseURL,
        testRunId,
      }) => {
        await runScenario({ browser, baseURL, testRunId }, { resolver, laterWriter });
      });
    }
  }
});
