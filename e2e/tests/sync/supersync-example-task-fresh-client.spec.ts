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
 * Two distinct guarantees for onboarding example tasks vs an incoming populated account:
 *
 * TEST 1 (#7976) — the SYNC_IMPORT conflict GATE. ExampleTasksService creates onboarding
 * task-create ops on first run. When a fresh client then syncs an account that already has
 * remote data, those pending ops used to make the conflict gate treat the client as having
 * meaningful local work, so it showed a `dialog-sync-import-conflict` instead of silently
 * accepting the import. This test guards the op-log `isExampleTask` marker + gate exclusion
 * (it does NOT exercise the afterInitialSyncDoneStrict$ timing — on a fresh e2e client sync
 * is disabled at boot, so example tasks are created before sync is configured regardless;
 * the marker is what suppresses the dialog here). Method: `waitForInitialSync: false` so
 * setup does NOT auto-resolve the dialog, then race "dialog visible" vs "sync complete".
 *
 * TEST 2 (#7996) — LOCAL-STATE cleanup + NO cross-device propagation. On the SuperSync
 * (op-based) path, adoption MERGES remote ops into the store rather than replacing it, so
 * #7995 rejecting the example UPLOAD ops still left the example tasks lingering in the
 * adopting device's local NgRx state (where a later snapshot upload would re-pollute the
 * remote). #7996 also removes them from local state on adoption. This test seeds a
 * NON-encrypted account by normal upload (the #7980 residual case — no SYNC_IMPORT fires
 * the incoming-import gate's discard), then asserts the fresh client's local store is clean
 * AND that a third observer device adopting the same account never sees the example tasks
 * (they never reached the server).
 *
 * REPRODUCE-FIRST: Test 1 fails on `bb4b625645^` (race → 'dialog'); Test 2's local-store
 * assertion fails pre-#7996 (op-based merge keeps the examples). Run on both before trusting.
 * Docker SuperSync is required and is NOT runnable in the CI/agent sandbox — run in a real
 * shell.
 *
 * Run: npm run e2e:supersync:file e2e/tests/sync/supersync-example-task-fresh-client.spec.ts -- --retries=0
 */
const EXAMPLE_TASK_TITLES = [
  'Create your first project',
  'Set up Sync',
  'Learn the keyboard shortcuts',
  'Go further',
];

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
      // onboarding example tasks survive. Example tasks live in the INBOX project.
      // (If the seeder's task lands elsewhere on your setup, adjust this navigation.)
      await freshClient.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await freshClient.page.waitForLoadState('networkidle');
      await waitForTask(freshClient.page, realTask);

      const titles = await getTaskTitles(freshClient);
      for (const exampleTitle of EXAMPLE_TASK_TITLES) {
        expect(titles).not.toContain(exampleTitle);
      }
    } finally {
      if (freshClient) {
        await closeClient(freshClient);
      }
      if (seeder) {
        await closeClient(seeder);
      }
    }
  });

  test('adoption removes example tasks from local state and they never propagate (#7996)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const appUrl = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();
    let seeder: SimulatedE2EClient | null = null;
    let freshClient: SimulatedE2EClient | null = null;
    let observer: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      // NON-encrypted account: the first device seeds via normal upload (no SYNC_IMPORT),
      // so the incoming-import gate's discard never fires — the exact #7980 residual case.
      const syncConfig = { ...getSuperSyncConfig(user), isEncryptionEnabled: false };

      // Seed the account with one real task (example tasks suppressed for the seeder).
      seeder = await createSimulatedClient(browser, appUrl, 'Seeder', testRunId);
      await seeder.sync.setupSuperSync(syncConfig);
      const realTask = `Real-Task-${uniqueId}`;
      await seeder.workView.addTask(realTask);
      await seeder.sync.syncAndWait();

      // Fresh client WITH onboarding example tasks (created at boot, before sync config)
      // adopts the populated remote silently (no conflict dialog → #7976), then syncs so
      // any pending ops are pushed.
      freshClient = await createSimulatedClient(browser, appUrl, 'Fresh', testRunId, {
        allowExampleTasks: true,
      });
      await freshClient.sync.setupSuperSync(syncConfig);
      await freshClient.sync.syncAndWait();

      // #7996: the example tasks are removed from the fresh client's LOCAL state on adoption.
      await freshClient.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await freshClient.page.waitForLoadState('networkidle');
      await waitForTask(freshClient.page, realTask);
      const freshTitles = await getTaskTitles(freshClient);
      for (const exampleTitle of EXAMPLE_TASK_TITLES) {
        expect(freshTitles).not.toContain(exampleTitle);
      }

      // Observer device (no example tasks of its own) adopts the same account. Because the
      // example tasks (and their delete) never reached the server, they never propagate here.
      observer = await createSimulatedClient(browser, appUrl, 'Observer', testRunId);
      await observer.sync.setupSuperSync(syncConfig);
      await observer.sync.syncAndWait();

      await observer.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await observer.page.waitForLoadState('networkidle');
      await waitForTask(observer.page, realTask);

      const observerTitles = await getTaskTitles(observer);
      for (const exampleTitle of EXAMPLE_TASK_TITLES) {
        expect(observerTitles).not.toContain(exampleTitle);
      }
    } finally {
      if (observer) {
        await closeClient(observer);
      }
      if (freshClient) {
        await closeClient(freshClient);
      }
      if (seeder) {
        await closeClient(seeder);
      }
    }
  });
});
