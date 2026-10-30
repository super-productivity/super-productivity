import { SuperSyncSnapshotUploadResponseSchema } from '../../../packages/shared-schema/src';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  archiveTask,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getArchiveYoungTaskIds,
  getLocalOpLogSummary,
  getSuperSyncConfig,
  SUPERSYNC_SNAPSHOT_ROUTE,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

// The normal page-object method waits for a successful upload. These tests must
// regain control at a failed upload or an earlier, committed local boundary.
const beginPasswordChange = async (
  client: SimulatedE2EClient,
  password: string,
): Promise<void> => {
  await client.sync.syncBtn.click({ button: 'right', noWaitAfter: true });
  await client.page.locator('.e2e-change-password-btn button').click();
  const dialog = client.page.locator('dialog-change-encryption-password');
  const confirm = dialog.locator('button[mat-flat-button][color="warn"]');
  await expect(async () => {
    for (const name of ['newPassword', 'confirmPassword']) {
      const input = dialog.locator(`input[name="${name}"]`);
      await input.fill(password);
      await input.blur();
    }
    await expect(confirm).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await confirm.click();
};

test.describe('@supersync interrupted encryption password change', () => {
  for (const boundary of ['local snapshot', 'saved credentials', 'server commit']) {
    test(`retains tasks and archives after reload at ${boundary}`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(180000);
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const oldPassword = `old-${testRunId}`;
        const newPassword = `new-${testRunId}`;
        const taskTitle = `Active-${testRunId}`;
        const archiveTitle = `Archived-${testRunId}`;
        const origin = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(origin);

        // Log binds console methods at bootstrap. Throw at an observed commit
        // boundary, then reload: no mocked service or uncommitted fake snapshot.
        await origin.page.addInitScript(
          (cutoff) => {
            const flags = globalThis as typeof globalThis & {
              __SP_E2E_BLOCK_AUTO_SYNC?: boolean;
              __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
              __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
            };
            flags.__SP_E2E_BLOCK_AUTO_SYNC =
              sessionStorage.getItem('password-change-interrupted') === 'true';
            flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
            flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
            const originalLog = console.log.bind(console);
            console.log = (...args: unknown[]): void => {
              originalLog(...args);
              if (
                cutoff &&
                sessionStorage.getItem('password-change-armed') === 'true' &&
                args.map(String).join(' ').includes(cutoff)
              ) {
                sessionStorage.removeItem('password-change-armed');
                sessionStorage.setItem('password-change-interrupted', 'true');
                throw new Error('Injected password-change interruption');
              }
            };
          },
          boundary === 'local snapshot'
            ? 'EncryptionPasswordChangeService: Verified SYNC_IMPORT stored'
            : boundary === 'saved credentials'
              ? 'EncryptionPasswordChangeService: Uploading clean slate with new encryption'
              : '',
        );
        await origin.page.reload();
        await waitForAppReady(origin.page);
        await origin.sync.setupSuperSync({ ...config, password: oldPassword });
        await origin.workView.addTask(taskTitle);
        await origin.workView.addTask(archiveTitle);
        await archiveTask(origin, archiveTitle);
        await origin.sync.syncAndWait();
        const archiveIds = await getArchiveYoungTaskIds(origin.page);
        expect(archiveIds).toHaveLength(1);

        let committedUploads = 0;
        if (boundary === 'server commit') {
          await origin.page.route(SUPERSYNC_SNAPSHOT_ROUTE, async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            if (committedUploads === 0) {
              const response = await route.fetch();
              expect(response.ok()).toBe(true);
              const body = SuperSyncSnapshotUploadResponseSchema.parse(
                await response.json(),
              );
              expect(body.accepted).toBe(true);
              committedUploads++;
              await origin.page.evaluate(() =>
                sessionStorage.setItem('password-change-interrupted', 'true'),
              );
            }
            // The server really committed, but this client never receives the
            // acknowledgement, including on any automatic request retry.
            await route.abort('connectionfailed');
          });
        }
        await origin.page.evaluate(() =>
          sessionStorage.setItem('password-change-armed', 'true'),
        );
        await beginPasswordChange(origin, newPassword);
        await expect
          .poll(() =>
            origin.page.evaluate(() =>
              sessionStorage.getItem('password-change-interrupted'),
            ),
          )
          .toBe('true');
        expect(committedUploads).toBe(boundary === 'server commit' ? 1 : 0);
        expect(await getLocalOpLogSummary(origin.page)).toContainEqual({
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          isSynced: false,
        });

        await origin.page.reload();
        await waitForAppReady(origin.page);
        await origin.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE);
        await waitForTask(origin.page, taskTitle);
        expect(await getArchiveYoungTaskIds(origin.page)).toEqual(archiveIds);
        // SUP_OPS and credentials are different databases. Check which key
        // survived this boundary before the user explicitly retries the change.
        const savedPassword = await origin.page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('sup-sync');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<string | undefined>((resolve, reject) => {
              const request = db
                .transaction('credentials')
                .objectStore('credentials')
                .get('__sp_cred_SuperSync');
              request.onsuccess = () => resolve(request.result?.encryptKey);
              request.onerror = () => reject(request.error);
            });
          } finally {
            db.close();
          }
        });
        expect(savedPassword).toBe(
          boundary === 'local snapshot' ? oldPassword : newPassword,
        );

        // The documented recovery is Change Password again with the same key.
        await origin.sync.changeEncryptionPassword(newPassword);
        const peer = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        clients.push(peer);
        await peer.sync.setupSuperSync({ ...config, password: newPassword });
        await waitForTask(peer.page, taskTitle);
        expect(await getArchiveYoungTaskIds(peer.page)).toEqual(archiveIds);
        await peer.page.reload();
        await waitForAppReady(peer.page);
        await waitForTask(peer.page, taskTitle);
        expect(await getArchiveYoungTaskIds(peer.page)).toEqual(archiveIds);
      } finally {
        const results = await Promise.allSettled(clients.map(closeClient));
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) {
          throw new AggregateError(
            failures.map((result) => result.reason),
            'Sync client cleanup failed',
          );
        }
      }
    });
  }
});
