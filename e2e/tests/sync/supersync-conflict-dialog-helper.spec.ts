import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  archiveDoneTasks,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  markTaskDoneByKey,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Pins what SuperSyncPage.syncAndWait() does at the fail-closed multi-entity stop
 * (SYNC_MULTI_ENTITY_UNSUPPORTED), on the real thing: one device holds two pending
 * bulk archives (archive, restore, archive with no sync in between, the same real UI
 * sequence as webdav-multi-archive-recovery.spec.ts) while another device edits one of
 * the archived tasks. A manual sync then ends at the whole-dataset conflict dialog
 * (`dialog-sync-conflict`, "Keep local" / "Keep remote").
 *
 * Either answer replaces ALL data on the other side, so the helper never picks one for
 * a test. By default it throws, quotes the app's diagnostic and leaves the dialog
 * open. Only `syncAndWait({ conflictDialog })` answers it, and it then waits until the
 * sync is confirmed again.
 *
 * This pins the CURRENT surface of that stop: the dialog and its diagnostic. It will
 * change when the #10342 fallback lands, so update or replace it then.
 */

const LOCAL_ONLY_TASK = 'Local-only task';
const REMOTE_ONLY_TASK = 'Remote-only task';
const STOP_DIAGNOSTIC =
  'SYNC_MULTI_ENTITY_UNSUPPORTED side=local actionType=[Task Shared] moveToArchive entityCount=2';

/** Only the helper may start a sync cycle: no automatic sync, upload or download. */
const blockBackgroundSync = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const flags = globalThis as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });

const archiveTasks = async (
  client: SimulatedE2EClient,
  titles: string[],
): Promise<void> => {
  for (const title of titles) {
    await markTaskDoneByKey(client, title);
  }
  await archiveDoneTasks(client);
  await expect(client.page.locator('task')).toHaveCount(0);
};

const restoreFromArchive = async (page: Page, title: string): Promise<void> => {
  await page.goto('/#/tag/TODAY/history');
  await page.locator('history .week-row .day-toggle').first().click();
  const row = page.locator('.task-summary-table tr', { hasText: title });
  await row.getByRole('button', { name: 'Restore task from archive' }).click();
  await page.getByRole('button', { name: 'Do it!' }).click();
  await expect(page.locator('task', { hasText: title })).toBeVisible();
};

/**
 * Leaves `local` one manual sync away from the stop: two overlapping pending bulk
 * archives plus a local-only task, against `remote`'s edit of one archived task and
 * its remote-only task, which are already on the server.
 */
const setUpStop = async (
  browser: Browser,
  baseURL: string,
  testRunId: string,
  clients: SimulatedE2EClient[],
): Promise<{ local: SimulatedE2EClient; remote: SimulatedE2EClient }> => {
  const config = getSuperSyncConfig(await createTestUser(testRunId));
  const local = await createSimulatedClient(browser, baseURL, 'Local', testRunId);
  clients.push(local);
  const remote = await createSimulatedClient(browser, baseURL, 'Remote', testRunId);
  clients.push(remote);
  const titles = [`ArchA-${testRunId}`, `ArchB-${testRunId}`];

  await local.sync.setupSuperSync(config);
  await blockBackgroundSync(local.page);
  for (const title of titles) {
    await local.workView.addTask(title);
  }
  await local.sync.syncAndWait();
  // Finish Day requests its own sync. Model an offline device so that the first archive
  // cannot reach the server before the second one exists.
  await local.page.route('**/api/sync/**', (route) => route.abort());

  await remote.sync.setupSuperSync(config);
  await remote.sync.syncAndWait();
  await blockBackgroundSync(remote.page);
  for (const title of titles) {
    await waitForTask(remote.page, title);
  }
  await markTaskDoneByKey(remote, titles[0]);
  await remote.workView.addTask(REMOTE_ONLY_TASK);
  await remote.sync.syncAndWait();

  await archiveTasks(local, titles);
  for (const title of titles) {
    await restoreFromArchive(local.page, title);
  }
  await archiveTasks(local, titles);
  await local.workView.addTask(LOCAL_ONLY_TASK);
  await expect(local.sync.syncSpinner).not.toBeVisible({ timeout: 30000 });
  await local.page.unroute('**/api/sync/**');
  return { local, remote };
};

test.describe('@supersync whole-dataset conflict dialog and syncAndWait()', () => {
  test('fails at the multi-entity stop, quotes its diagnostic and leaves the dialog open', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const clients: SimulatedE2EClient[] = [];
    try {
      const { local } = await setUpStop(browser, baseURL!, testRunId, clients);

      const failure = await local.sync.syncAndWait().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(failure, 'syncAndWait() must not answer the dialog itself').toBeInstanceOf(
        Error,
      );
      const message = (failure as Error).message;
      expect(message).toContain('Unexpected whole-dataset conflict dialog');
      expect(message).toContain(STOP_DIAGNOSTIC);
      await expect(local.sync.conflictDialog).toBeVisible();
      // Neither side was chosen, so nothing was replaced.
      await expect(
        local.page.locator('task', { hasText: LOCAL_ONLY_TASK }),
      ).toBeVisible();
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });

  test("answers the stop with { conflictDialog: 'local' } and the other device converges", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const clients: SimulatedE2EClient[] = [];
    try {
      const { local, remote } = await setUpStop(browser, baseURL!, testRunId, clients);

      await local.sync.syncAndWait({ conflictDialog: 'local', timeout: 60000 });

      await expect(local.sync.conflictDialog).toBeHidden();
      await expect(local.sync.syncErrorIcon).toBeHidden();
      // Keep local: the local-only task is kept and the remote-only task is dropped.
      await expect(
        local.page.locator('task', { hasText: LOCAL_ONLY_TASK }),
      ).toBeVisible();
      await expect(local.page.locator('task', { hasText: REMOTE_ONLY_TASK })).toHaveCount(
        0,
      );
      await expect(local.page.locator('task')).toHaveCount(1);

      await remote.sync.syncAndWait();
      await expect(
        remote.page.locator('task', { hasText: LOCAL_ONLY_TASK }),
      ).toBeVisible();
      await expect(
        remote.page.locator('task', { hasText: REMOTE_ONLY_TASK }),
      ).toHaveCount(0);
      await expect(remote.page.locator('task')).toHaveCount(1);
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });
});
