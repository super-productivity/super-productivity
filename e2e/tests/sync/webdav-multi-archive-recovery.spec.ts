import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  generateSyncFolderName,
  waitForSyncComplete,
  closeContextsSafely,
} from '../../utils/sync-helpers';

const blockBackgroundSync = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const flags = globalThis as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
  });
};

const archiveTasks = async (page: Page, titles: string[]): Promise<void> => {
  for (const title of titles) {
    await new TaskPage(page).markTaskAsDone(page.locator('task', { hasText: title }));
  }
  await page.locator('.e2e-finish-day').click();
  await page.locator('daily-summary').waitFor();
  await page
    .locator('daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))')
    .click();
  await expect(page).toHaveURL(/#\/tag\/TODAY\/tasks/);
  await expect(page.locator('task')).toHaveCount(0);
};

// Real UI actions produce archive -> restore -> archive without a sync between.
// Both local archive rows overlap a remote edit, reaching the safety stop in
// _assertMultiEntityPlansAreSafe. No sync service or operation is mocked.
test.describe('@webdav overlapping bulk archive recovery (#10102)', () => {
  test.describe.configure({ mode: 'serial' });

  for (const choice of ['Keep local', 'Keep remote']) {
    test(`${choice} clears the wedge and subsequent syncs converge`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }) => {
      void webdavServerUp;
      test.slow();
      const folder = generateSyncFolderName('multi-archive-recovery');
      await createSyncFolder(request, folder);
      const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      const local = await setupSyncClient(browser, baseURL);
      const remote = await setupSyncClient(browser, baseURL);
      try {
        const localSync = new SyncPage(local.page);
        const remoteSync = new SyncPage(remote.page);
        const localWork = new WorkViewPage(local.page);
        const remoteWork = new WorkViewPage(remote.page);
        const titles = ['Shared archive task A', 'Shared archive task B'];
        // Watch BOTH devices: a recurrence on the remote after recovery would
        // otherwise go unnoticed, since every remote-side task assertion below
        // is already satisfied by its pre-recovery state.
        const diagnostics: string[] = [];
        const remoteDiagnostics: string[] = [];
        for (const [page, sink] of [
          [local.page, diagnostics],
          [remote.page, remoteDiagnostics],
        ] as const) {
          page.on('console', (message) => {
            if (message.text().includes('SYNC_MULTI_ENTITY_UNSUPPORTED')) {
              sink.push(message.text());
            }
          });
        }

        await localSync.setupWebdavSync(config);
        await waitForSyncComplete(local.page, localSync);
        await blockBackgroundSync(local.page);
        for (const title of titles) await localWork.addTask(title);
        await localSync.triggerSync();
        await waitForSyncComplete(local.page, localSync);
        // Finish Day requests its own sync. Model an offline device so those
        // requests cannot upload the first archive before the second exists.
        await local.page.route('http://127.0.0.1:2345/**', (route) => route.abort());

        await remoteSync.setupWebdavSync(config);
        await waitForSyncComplete(remote.page, remoteSync);
        await blockBackgroundSync(remote.page);
        await expect(remote.page.locator('task')).toHaveCount(2);
        await new TaskPage(remote.page).markTaskAsDone(
          remote.page.locator('task', { hasText: titles[0] }),
        );
        await remoteWork.addTask('Remote-only task');
        await remoteSync.triggerSync();
        await waitForSyncComplete(remote.page, remoteSync);

        await archiveTasks(local.page, titles);
        for (const title of titles) {
          await local.page.goto('/#/tag/TODAY/history');
          await local.page.locator('history .week-row .day-toggle').first().click();
          const row = local.page.locator('.task-summary-table tr', { hasText: title });
          await row.getByRole('button', { name: 'Restore task from archive' }).click();
          await local.page.getByRole('button', { name: 'Do it!' }).click();
          await expect(local.page.locator('task', { hasText: title })).toBeVisible();
        }
        await archiveTasks(local.page, titles);
        await localWork.addTask('Local-only task');
        await expect(localSync.syncSpinner).not.toBeVisible({ timeout: 30000 });
        await local.page.unroute('http://127.0.0.1:2345/**');

        await localSync.triggerSync();
        const dialog = local.page.locator('dialog-sync-conflict');
        await expect(dialog).toBeVisible();
        expect(diagnostics.join('\n')).toContain(
          'side=local actionType=[Task Shared] moveToArchive entityCount=2',
        );
        const localCount = dialog
          .locator('table')
          .first()
          .locator('tr')
          .nth(2)
          .locator('td')
          .last();
        expect(Number(await localCount.innerText())).toBeGreaterThan(0);
        // Cancel preserves the local version and the same real conflict recurs.
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(
          local.page.locator('task', { hasText: 'Local-only task' }),
        ).toBeVisible();
        await localSync.triggerSync();
        await expect(dialog).toBeVisible();
        expect(diagnostics.length).toBeGreaterThan(1);

        await dialog.getByRole('button', { name: choice, exact: true }).click();
        const confirmation = local.page.locator('dialog-confirm');
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText('replace the entire');
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(confirmation).not.toBeVisible();
        await expect(dialog).toBeVisible();
        await expect(
          local.page.locator('task', { hasText: 'Local-only task' }),
        ).toBeVisible();
        await dialog.getByRole('button', { name: choice, exact: true }).click();
        await confirmation.locator('[e2e="confirmBtn"]').click();
        await expect(dialog).not.toBeVisible();
        // The force upload/download runs AFTER the dialog closes, and the
        // status is already ERROR (set before the dialog opened) so no spinner
        // renders — the manual-trigger settle check would read "idle" and fire
        // the next sync mid-recovery. Wait for the error state to clear.
        await expect(localSync.syncErrorIcon).not.toBeVisible({ timeout: 60000 });

        // Real force recovery must clear pending conflicting history, not merely
        // report success once. Exercise subsequent downloads and uploads twice.
        const failuresBeforeRecovery = diagnostics.length;
        for (let round = 0; round < 2; round++) {
          await localSync.triggerSync();
          expect(await waitForSyncComplete(local.page, localSync)).toBe('success');
          await remoteSync.triggerSync();
          expect(await waitForSyncComplete(remote.page, remoteSync)).toBe('success');
        }
        expect(diagnostics.length).toBe(failuresBeforeRecovery);
        expect(remoteDiagnostics).toEqual([]);
        const kept = choice === 'Keep local' ? 'Local-only task' : 'Remote-only task';
        const discarded =
          choice === 'Keep local' ? 'Remote-only task' : 'Local-only task';
        for (const page of [local.page, remote.page]) {
          await expect(page.locator('task', { hasText: kept })).toBeVisible();
          await expect(page.locator('task', { hasText: discarded })).toHaveCount(0);
          if (choice === 'Keep local') {
            await page.goto('/#/tag/TODAY/history');
            await page.locator('history .week-row .day-toggle').first().click();
            for (const title of titles) {
              await expect(
                page.locator('.task-summary-table tr', { hasText: title }),
              ).toBeVisible();
            }
          } else {
            for (const title of titles) {
              await expect(page.locator('task', { hasText: title })).toBeVisible();
            }
          }
        }
      } finally {
        await closeContextsSafely(local.context, remote.context);
      }
    });
  }
});
