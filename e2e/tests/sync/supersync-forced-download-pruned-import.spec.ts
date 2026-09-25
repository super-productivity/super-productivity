import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  hasTask,
  renameTask,
  type SimulatedE2EClient,
  SUPERSYNC_BASE_URL,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { readRecoveryRing } from '../../utils/recovery-ring-helpers';

/**
 * Regression: a forced seq-0 download must not resurface an already-applied,
 * locally compacted SYNC_IMPORT as a "new incoming import".
 *
 * Background: when an upload is rejected CONFLICT_CONCURRENT and the follow-up
 * download brings nothing new, RejectedOpsHandlerService forces a download
 * from seq 0 to rebuild clock state. The server fast-forwards such a request
 * to its latest full-state op and includes it. If local compaction (7-day
 * retention) already pruned that import from the op log, the applied-id
 * filter no longer recognises it, the conflict gate treats it as an incoming
 * import, and — with the rejected op still pending — shows the sync-import
 * conflict dialog (reason: "password changed on another device", although
 * nothing changed). Both dialog answers are harmful: USE_REMOTE discards the
 * pending local work, USE_LOCAL uploads a fresh SYNC_IMPORT that prompts every
 * other device.
 *
 * Fix: the forced download skips ops that sit behind the persisted cursor AND
 * are covered by the local vector clock (OperationLogDownloadService).
 *
 * Discriminators: the "Incoming SYNC_IMPORT ... Showing conflict dialog" log
 * line and the dialog itself must NOT appear on the client that hits the
 * forced download; the "Skipped N re-delivered op(s)" line MUST appear.
 * The re-delivered import must not rotate the local recovery ring either
 * (local-recovery-points.md): it never replaces state, so it never captures.
 * syncAndWait() auto-resolves the import dialog, so the dialog is watched
 * independently — otherwise a buggy run would pass vacuously.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-forced-download-pruned-import.spec.ts
 */

interface ServerOperationSummary {
  id: string;
  opType: string;
  serverSeq: number;
  clientId?: string;
}

const getServerOperations = async (userId: number): Promise<ServerOperationSummary[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=200`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect server operations: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { ops: ServerOperationSummary[] };
  return body.ops;
};

/**
 * Mirrors OperationLogCompactionService's delete predicate as if the 7-day
 * retention window had elapsed: every synced, fully applied op at or below the
 * snapshot's lastAppliedOpSeq is deleted. The state cache and the durable
 * vector clock stay untouched — exactly what real compaction leaves behind.
 * The full-state ref index is dropped so the store rebuilds it from the
 * remaining ops on next access.
 */
const pruneSyncedOpsLikeCompaction = (
  page: Page,
): Promise<{ deletedCount: number; deletedFullStateOpIds: string[] }> =>
  page.evaluate(async () => {
    const FULL_STATE_OP_TYPES = ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('SUP_OPS');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = db.transaction(['ops', 'state_cache', 'meta'], 'readwrite');
      const snapshot = await new Promise<{ lastAppliedOpSeq?: number } | undefined>(
        (resolve, reject) => {
          const req = tx.objectStore('state_cache').get('current');
          req.onsuccess = () =>
            resolve(req.result as { lastAppliedOpSeq?: number } | undefined);
          req.onerror = () => reject(req.error);
        },
      );
      const lastAppliedOpSeq = snapshot?.lastAppliedOpSeq ?? 0;

      let deletedCount = 0;
      const deletedFullStateOpIds: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const req = tx.objectStore('ops').openCursor();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          const entry = cursor.value as {
            seq: number;
            syncedAt?: number;
            applicationStatus?: string;
            op: { id?: string; opType?: string; o?: string };
          };
          const isApplied =
            entry.applicationStatus === undefined ||
            entry.applicationStatus === 'applied';
          if (
            entry.syncedAt !== undefined &&
            isApplied &&
            entry.seq <= lastAppliedOpSeq
          ) {
            const opType = entry.op.opType ?? entry.op.o;
            if (opType && FULL_STATE_OP_TYPES.includes(opType) && entry.op.id) {
              deletedFullStateOpIds.push(entry.op.id);
            }
            deletedCount++;
            cursor.delete();
          }
          cursor.continue();
        };
      });
      await new Promise<void>((resolve, reject) => {
        const req = tx.objectStore('meta').delete('full_state_ops');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return { deletedCount, deletedFullStateOpIds };
    } finally {
      db.close();
    }
  });

/** Existing client picks up another device's password change. */
const recoverWithNewPassword = async (
  client: SimulatedE2EClient,
  newPassword: string,
): Promise<void> => {
  const decryptErrorDialog = client.page.locator('dialog-handle-decrypt-error');
  if (!(await decryptErrorDialog.isVisible().catch(() => false))) {
    await client.sync.syncBtn.click();
  }
  await decryptErrorDialog.waitFor({ state: 'visible', timeout: 15000 });
  const passwordInput = decryptErrorDialog.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
  await passwordInput.fill(newPassword);
  await decryptErrorDialog.locator('button:has-text("Retry Decrypt")').first().click();
  await decryptErrorDialog.waitFor({ state: 'hidden', timeout: 10000 });

  const importDialogAppeared = await client.sync.syncImportConflictDialog
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (importDialogAppeared) {
    await client.sync.chooseSyncImportUseRemote();
  }
  await client.sync.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
  await client.sync.syncAndWait();
};

/** Reboot the client so hydration writes a fresh snapshot and caches reset. */
const reloadClient = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.reload();
  await waitForAppReady(client.page);
  await client.sync.syncAndWait();
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test.describe('@supersync Forced download re-delivering a pruned SYNC_IMPORT', () => {
  test('a concurrent-rejection retry does not raise the import conflict dialog for an already-applied import', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync({ ...baseConfig, password: oldPassword });
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({ ...baseConfig, password: oldPassword });

      // 1. Shared task, both clients in sync.
      const sharedTask = `Shared-${testRunId}`;
      await clientA.workView.addTask(sharedTask);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, sharedTask);

      // 2. B changes the password → B uploads a SYNC_IMPORT (PASSWORD_CHANGED),
      //    then some ordinary post-import work.
      await clientB.sync.changeEncryptionPassword(newPassword);
      const postImportTask = `PostImport-B-${testRunId}`;
      await clientB.workView.addTask(postImportTask);
      await clientB.sync.syncAndWait();

      const serverOps = await getServerOperations(user.userId);
      const importOp = serverOps.find((op) => op.opType === 'SYNC_IMPORT');
      expect(importOp).toBeDefined();
      if (!importOp) throw new Error('Expected a SYNC_IMPORT on the server');

      // 3. A adopts the new password and applies B's import + follow-up ops.
      await recoverWithNewPassword(clientA, newPassword);
      await waitForTask(clientA.page, sharedTask);
      await waitForTask(clientA.page, postImportTask);

      // 4. Age out A's log the way compaction does: reboot so the snapshot
      //    covers everything, prune synced ops behind it, reboot again so the
      //    in-memory applied-id cache forgets them.
      await reloadClient(clientA);
      const pruned = await pruneSyncedOpsLikeCompaction(clientA.page);
      console.log(
        `[Pruned import] deleted ${pruned.deletedCount} op(s), full-state: ${pruned.deletedFullStateOpIds.join(',')}`,
      );
      // Precondition guard: the import is gone from A's log, as after 7 days.
      expect(pruned.deletedFullStateOpIds).toContain(importOp.id);
      await reloadClient(clientA);
      await waitForTask(clientA.page, sharedTask);
      await waitForTask(clientA.page, postImportTask);

      // 5. Concurrent edits on the shared task; B's reaches the server first.
      const titleFromB = `${sharedTask}-B`;
      const titleFromA = `${sharedTask}-A`;
      await renameTask(clientB, sharedTask, titleFromB);
      await clientB.sync.syncAndWait();
      await renameTask(clientA, sharedTask, titleFromA);
      // Applying B's import in step 3 captured A's pre-import state once.
      const ringBefore = await readRecoveryRing(clientA.page);
      expect(ringBefore).toHaveLength(1);

      // 6. Steer A's sync into the forced seq-0 path (same technique as the
      //    #8331 spec): keep the pre-upload download empty so A uploads a
      //    genuinely concurrent op and the real server rejects it; strip the
      //    piggybacked remote op so the client falls back to the resolution
      //    download; keep that one empty too so the handler forces seq 0.
      //    The forced download (sinceSeq=0) goes to the real server untouched.
      let sawUploadAttempt = false;
      let strippedPreUploadDownloads = 0;
      let strippedResolutionDownloads = 0;
      let forcedDownloads = 0;
      let concurrentRejectedOpId: string | null = null;
      await clientA.page.route('**/api/sync/ops*', async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          const sinceSeq = Number(
            new URL(route.request().url()).searchParams.get('sinceSeq') ?? 0,
          );
          if (sinceSeq === 0) {
            forcedDownloads++;
            await route.continue();
            return;
          }
          const response = await route.fetch();
          const json = await response.json();
          json.ops = [];
          json.hasMore = false;
          json.latestSeq = sinceSeq;
          if (sawUploadAttempt) {
            strippedResolutionDownloads++;
          } else {
            strippedPreUploadDownloads++;
          }
          await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify(json),
          });
          return;
        }
        if (method === 'POST') {
          sawUploadAttempt = true;
          const response = await route.fetch();
          const json = await response.json();
          const concurrentResult = Array.isArray(json.results)
            ? json.results.find(
                (result: { errorCode?: unknown }) =>
                  result.errorCode === 'CONFLICT_CONCURRENT',
              )
            : undefined;
          if (typeof concurrentResult?.opId === 'string') {
            concurrentRejectedOpId = concurrentResult.opId;
          }
          if (Array.isArray(json.newOps) && json.newOps.length > 0) {
            json.newOps = [];
            json.hasMorePiggyback = false;
          }
          await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify(json),
          });
          return;
        }
        await route.continue();
      });

      // Watch the discriminators independently of syncAndWait(), which would
      // otherwise answer the dialog itself.
      const consoleLines: string[] = [];
      const onConsole = (msg: { text: () => string }): void => {
        consoleLines.push(msg.text());
      };
      clientA.page.on('console', onConsole);
      let importDialogSeen = false;
      let stopWatching = false;
      const importDialog = clientA.page.locator('dialog-sync-import-conflict');
      const dialogWatcher = (async () => {
        while (!stopWatching) {
          if (await importDialog.isVisible().catch(() => false)) {
            importDialogSeen = true;
            return;
          }
          await sleep(100);
        }
      })();

      try {
        await clientA.sync.syncAndWait({ timeout: 60000 });
      } finally {
        stopWatching = true;
        await dialogWatcher;
        clientA.page.off('console', onConsole);
        await clientA.page.unroute('**/api/sync/ops*');
      }

      // Setup guards: the path under test must actually have run.
      expect(strippedPreUploadDownloads).toBeGreaterThanOrEqual(1);
      expect(concurrentRejectedOpId).not.toBeNull();
      expect(strippedResolutionDownloads).toBeGreaterThanOrEqual(1);
      expect(forcedDownloads).toBeGreaterThanOrEqual(1);

      // Discriminators.
      const incomingImportLines = consoleLines.filter((line) =>
        /Incoming SYNC_IMPORT from client .* Showing conflict dialog/.test(line),
      );
      expect(incomingImportLines).toEqual([]);
      expect(importDialogSeen).toBe(false);
      const skippedMatch = consoleLines
        .map((line) => /Skipped (\d+) re-delivered op\(s\)/.exec(line))
        .find((match) => match !== null);
      expect(skippedMatch).toBeDefined();
      expect(Number(skippedMatch?.[1])).toBeGreaterThanOrEqual(1);
      expect(await readRecoveryRing(clientA.page)).toEqual(ringBefore);

      // 7. Recovery proof: both clients converge on one title for the shared
      //    task and keep the post-import task.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, postImportTask);
      await waitForTask(clientB.page, postImportTask);
      const aHasA = await hasTask(clientA.page, titleFromA);
      const aHasB = await hasTask(clientA.page, titleFromB);
      const bHasA = await hasTask(clientB.page, titleFromA);
      const bHasB = await hasTask(clientB.page, titleFromB);
      expect(aHasA || aHasB).toBe(true);
      expect(aHasA).toBe(bHasA);
      expect(aHasB).toBe(bHasB);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
