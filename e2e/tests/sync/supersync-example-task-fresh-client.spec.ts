import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getTaskTitles,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Regression test for #7976 — a fresh client's first-run example tasks must not trip the
 * SYNC_IMPORT conflict gate when pulling an account that already has data.
 *
 * THE BUG: ExampleTasksService creates onboarding task-create ops on first run. When a
 * fresh client then syncs an account that already has remote data, those pending ops used
 * to make the conflict gate treat the client as having meaningful local work, so it showed
 * a `dialog-sync-import-conflict` instead of silently accepting the import.
 *
 * WHAT THIS GUARDS: the op-log `isExampleTask` marker + gate exclusion. It does NOT
 * exercise the afterInitialSyncDoneStrict$ timing — on a fresh e2e client sync is disabled
 * at boot, so example tasks are created before sync is configured regardless of the strict
 * gate; the marker is what suppresses the dialog here. Covering the strict-wait timing
 * needs a client with sync pre-enabled at boot (a separate test).
 *
 * METHOD: configure sync with `waitForInitialSync: false` so setupSuperSync does NOT
 * auto-resolve the conflict dialog (it otherwise clicks "Use Server Data"), then race
 * "conflict dialog visible" against "sync complete". The fix means sync completes WITHOUT
 * the dialog; pre-fix the dialog wins the race.
 *
 * REPRODUCE-FIRST: expected to FAIL on `bb4b625645^` (race resolves to 'dialog') and PASS
 * on the PR head. Run on both before trusting it.
 *
 * Run: npm run e2e:supersync:file e2e/tests/sync/supersync-example-task-fresh-client.spec.ts -- --retries=0
 */
const EXAMPLE_TASK_TITLES = ['Optional: getting started tips'];

test.describe('@supersync Fresh-client example tasks vs incoming import (#7976)', () => {
  test('import is accepted without an example-task conflict dialog', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();
    let seeder: SimulatedE2EClient | null = null;
    let freshClient: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Seed the account with real data (example tasks suppressed for the seeder).
      seeder = await createSimulatedClient(browser, appUrl, 'Seeder', testRunId);
      await seeder.sync.setupSuperSync(syncConfig);
      const realTask = `Real-Task-${uniqueId}`;
      await seeder.workView.addTask(realTask);
      await seeder.sync.syncAndWait();

      // Fresh client WITH onboarding example tasks (created at boot, before sync config).
      freshClient = await createSimulatedClient(browser, appUrl, 'Fresh', testRunId, {
        allowExampleTasks: true,
      });

      // Example tasks live in the INBOX project. Open it now and stay on it: seeing them
      // here proves the "none survives" check below is not vacuous, and it keeps the list
      // read after the import off a route swap. While a route animates (~225ms) the
      // leaving view stays mounted next to the entering one, so right after navigating, a
      // task listed in both TODAY and INBOX (the seeder's task is) shows up twice, and
      // waitForTask is satisfied by either view.
      await freshClient.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      // Same read and exact titles as the check after the import (waitForTask matches
      // substrings), so that check cannot pass vacuously if a title drifts from
      // EXAMPLE_TASK_TITLES.
      await expect
        .poll(() => getTaskTitles(freshClient!), {
          message: 'INBOX should list the example tasks before sync is configured',
        })
        .toEqual(expect.arrayContaining(EXAMPLE_TASK_TITLES));

      // Configure sync but do NOT let setup auto-resolve the conflict dialog
      // (waitForInitialSync:true would click "Use Server Data" and hide the bug).
      await freshClient.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });

      // Race: does the example-task conflict dialog appear, or does the initial sync
      // complete cleanly? (Pattern from supersync-import-clean-slate.spec.ts.)
      const syncResult = await Promise.race([
        freshClient.sync.syncImportConflictDialog
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'dialog' as const),
        freshClient.sync.syncCheckIcon
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'complete' as const),
      ]);

      // CORE REGRESSION: the import is accepted silently — no example-task conflict dialog.
      // Pre-fix this resolves to 'dialog'.
      expect(syncResult).toBe('complete');

      // The import replaced local state: the real remote task is present and NONE of the
      // onboarding example tasks survive.
      await waitForTask(freshClient.page, realTask);

      // `complete` above only means the check icon showed once, not that the import has
      // been applied: for a few hundred ms after it the real task is listed next to the
      // example tasks. So read the SETTLED list: poll the whole verdict, one atomic
      // snapshot per attempt (a count() followed by per-row reads waits out its timeout on
      // a row that a re-render removed in between).
      await expect
        .poll(
          async () => {
            const titles = await getTaskTitles(freshClient!);
            return {
              hasRealTask: titles.some((title) => title.includes(realTask)),
              survivingExampleTasks: titles.filter((title) =>
                EXAMPLE_TASK_TITLES.includes(title),
              ),
            };
          },
          {
            message: 'INBOX should list the imported task and none of the example tasks',
          },
        )
        .toEqual({ hasRealTask: true, survivingExampleTasks: [] });

      // Still no conflict dialog once everything has settled (the race above only saw the
      // first check icon).
      await expect(freshClient.sync.syncImportConflictDialog).toBeHidden();
      await expect(freshClient.sync.conflictDialog).toBeHidden();
    } finally {
      if (freshClient) {
        await closeClient(freshClient);
      }
      if (seeder) {
        await closeClient(seeder);
      }
    }
  });
});
