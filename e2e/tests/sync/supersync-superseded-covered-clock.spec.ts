import type { Page, Route } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  renameTask,
  routeSuperSyncOps,
  unrouteSuperSyncOps,
  parseSuperSyncRequestBody,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

type VectorClock = Record<string, number>;

// Reads one op-log entry's sync state straight from IndexedDB.
const getOpState = (
  page: Page,
  opId: string,
): Promise<'pending' | 'synced' | 'rejected' | 'missing'> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('SUP_OPS');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const entry = await new Promise<
        { syncedAt?: number; rejectedAt?: number } | undefined
      >((resolve, reject) => {
        const tx = db.transaction('ops', 'readonly');
        const request = tx.objectStore('ops').index('byId').get(id);
        request.onsuccess = () =>
          resolve(
            request.result as { syncedAt?: number; rejectedAt?: number } | undefined,
          );
        request.onerror = () => reject(request.error);
      });
      if (!entry) return 'missing';
      if (entry.rejectedAt !== undefined) return 'rejected';
      if (entry.syncedAt !== undefined) return 'synced';
      return 'pending';
    } finally {
      db.close();
    }
  }, opId);

/** Only explicit syncs reach the route: no automatic sync, upload or download. */
const blockBackgroundSync = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const flags = globalThis as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });

const mergeClocks = (a: VectorClock, b: VectorClock): VectorClock => {
  const merged = { ...a };
  for (const [id, counter] of Object.entries(b)) {
    merged[id] = Math.max(merged[id] ?? 0, counter);
  }
  return merged;
};

interface UploadBody {
  ops: Array<{ id: string; clientId: string; vectorClock: VectorClock }>;
}

interface DownloadBody {
  latestSeq?: number;
  ops?: Array<{ op: { vectorClock?: VectorClock } }>;
}

/**
 * Regression: a superseded edit whose server version this client already
 * covers resolves in the same sync, without a forced download from seq 0.
 *
 * Reported on Android after "finish day" on the desktop: the phone uploaded
 * three old pending edits of one task, the server rejected each as
 * CONFLICT_SUPERSEDED, the follow-up download found nothing new, and the phone
 * forced a re-download of the whole history (~104k ops) that never finished —
 * spinner forever, edits never uploaded. Its log showed every server counter
 * already covered by the local clock, e.g. `desktop: [server 24583, op 23271,
 * local 26325]`, so that download could not add a clock it lacked.
 *
 * Setup:
 * - How the phone's edits went stale is not reproduced; the rejection is
 *   injected with that logged shape: B's stale op, and an `existingClock` that
 *   is ahead of the op on A's counter but no further than what B has already
 *   downloaded from A in the same sync.
 * - Every forced-download page is aborted, as a full download of a long history
 *   does not complete on the reporting phone.
 *
 * Without the fix, each sync forces the download, which fails, and the edit
 * never leaves B. With it, B replaces the stale op with a merged one in the
 * first sync and the real server accepts it.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-superseded-covered-clock.spec.ts
 */
test.describe('@supersync Superseded edit with covered server clock', () => {
  test('resolves without a forced download and uploads the edit', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const appUrl = baseURL || 'http://localhost:4242';
    const MAX_SYNCS = 3;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Both clients share a task.
      const taskName = `Covered-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 2. B edits the task; this op is the one the server rejects. It must
      //    stay pending until B's next explicit sync.
      await blockBackgroundSync(clientB.page);
      const renamed = `${taskName}-ByB`;
      await renameTask(clientB, taskName, renamed);

      // 3. A keeps working, so B's next sync downloads ops that move B's clock
      //    past the op's before the op is uploaded.
      await clientA.workView.addTask(`Meanwhile-${testRunId}`);
      await clientA.sync.syncAndWait();

      let staleOpIds: Set<string> | null = null;
      let knownHeadSeq: number | undefined;
      let downloadedClock: VectorClock = {};
      let abortedForcedGets = 0;
      let injectedRejections = 0;
      let acceptedReplacementUploads = 0;
      let mixedUploads = 0;

      await routeSuperSyncOps(clientB.page, async (route: Route) => {
        const request = route.request();
        if (request.method() === 'GET') {
          const url = new URL(request.url());
          const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? 0);
          if (knownHeadSeq !== undefined && sinceSeq < knownHeadSeq) {
            // A forced download behind the head: it never completes.
            abortedForcedGets++;
            await route.abort('failed');
            return;
          }
          const response = await route.fetch();
          const json = (await response.json()) as DownloadBody;
          if (typeof json.latestSeq === 'number') {
            knownHeadSeq = Math.max(knownHeadSeq ?? 0, json.latestSeq);
          }
          for (const { op } of json.ops ?? []) {
            if (op.vectorClock) {
              downloadedClock = mergeClocks(downloadedClock, op.vectorClock);
            }
          }
          await route.fulfill({ response, json });
          return;
        }

        if (request.method() === 'POST') {
          const body = parseSuperSyncRequestBody<UploadBody>(request);
          staleOpIds ??= new Set(body.ops.map((op) => op.id));
          const staleOps = body.ops.filter((op) => staleOpIds!.has(op.id));
          if (staleOps.length === 0) {
            const response = await route.fetch();
            const json = await response.json();
            acceptedReplacementUploads += (
              json.results as Array<{ accepted: boolean }>
            ).filter((result) => result.accepted).length;
            await route.fulfill({ response, json });
            return;
          }
          if (staleOps.length !== body.ops.length) {
            mixedUploads++;
          }
          injectedRejections++;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: staleOps.map((op) => ({
                opId: op.id,
                accepted: false,
                error: 'Superseded operation: server has newer version of TASK',
                errorCode: 'CONFLICT_SUPERSEDED',
                // Ahead of the op, but only by what B has already downloaded.
                existingClock: mergeClocks(op.vectorClock, downloadedClock),
              })),
              latestSeq: knownHeadSeq ?? 0,
            }),
          });
          return;
        }
        await route.continue();
      });

      // 4. Sync until the edit is accepted. Failed syncs (the forced download
      //    aborting) are what the unfixed client does on every attempt.
      let syncsNeeded = 0;
      for (let i = 0; i < MAX_SYNCS && acceptedReplacementUploads === 0; i++) {
        syncsNeeded = i + 1;
        try {
          await clientB.sync.syncAndWait();
        } catch {
          console.log(`[Covered] sync ${i + 1} failed (forced download aborted)`);
        }
      }
      console.log(
        `[Covered] syncs=${syncsNeeded} abortedForcedGets=${abortedForcedGets} ` +
          `injectedRejections=${injectedRejections}`,
      );

      // Setup guards: the rejection was injected for the edit alone, and the
      // injected server clock was really ahead of the stale op.
      expect(injectedRejections).toBeGreaterThanOrEqual(1);
      expect(mixedUploads).toBe(0);
      expect(Object.keys(downloadedClock).length).toBeGreaterThan(0);

      // 5. No forced download, and the edit was replaced and accepted in the
      //    first sync.
      expect(abortedForcedGets).toBe(0);
      expect(syncsNeeded).toBe(1);
      expect(acceptedReplacementUploads).toBeGreaterThanOrEqual(1);
      for (const opId of staleOpIds ?? []) {
        expect(await getOpState(clientB.page, opId)).toBe('rejected');
      }

      // 6. End to end: A receives B's edit.
      await unrouteSuperSyncOps(clientB.page);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, renamed);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
