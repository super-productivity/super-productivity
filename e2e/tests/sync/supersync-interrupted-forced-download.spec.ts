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

interface UploadBody {
  ops: Array<{ id: string; clientId: string; vectorClock: Record<string, number> }>;
}

/**
 * Regression: a rejected-ops forced download that keeps getting cut off must
 * still finish, so the rejected edit reaches the server.
 *
 * Reported on Android: every upload of 72 pending ops was rejected as
 * CONFLICT_SUPERSEDED while downloads found nothing new, so the client forced a
 * full re-download from seq 0 (~30 pages) to rebuild its clock. Each time the
 * app was backgrounded the network dropped mid-way, the next sync restarted
 * from seq 0, and it never completed — spinner forever, edits never uploaded.
 *
 * Setup:
 * - The cause of those rejections (this client's clock behind what the server
 *   has seen from it) is not reproduced here; the rejection is injected for
 *   B's original op with an `existingClock` whose B counter is ahead of the
 *   op's — the shape the server sends for exactly that situation. What is
 *   under test is the recovery path the real rejection triggers.
 * - Forced-download pages are shrunk to one op (`limit=1`) so a small history
 *   spans many pages, and each sync may fetch only PAGES_PER_SYNC of them before
 *   its network "drops" (every further GET is aborted).
 *
 * - Between B's first attempts, A adds tasks, so B's cursor moves between an
 *   interrupted attempt and its resume (as with an active user or a second
 *   device) — resuming must survive it.
 *
 * Without resuming, every sync restarts at seq 0 and never gets past page
 * PAGES_PER_SYNC. With it, each sync continues where the last one stopped.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-interrupted-forced-download.spec.ts
 */
test.describe('@supersync Interrupted forced download', () => {
  test('a forced download cut off on every sync still completes and uploads the edit', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(420000);
    const appUrl = baseURL || 'http://localhost:4242';
    const PAGES_PER_SYNC = 3;
    const MAX_SYNCS = 12;
    const EXTRA_TASKS = 10;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. A builds a history long enough to span many one-op pages; B applies it.
      const taskName = `Interrupted-${testRunId}`;
      await clientA.workView.addTask(taskName);
      for (let i = 0; i < EXTRA_TASKS; i++) {
        await clientA.workView.addTask(`Filler-${i}-${testRunId}`);
      }
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 2. B edits the task; this op is the one the server keeps rejecting.
      const renamed = `${taskName}-ByB`;
      await renameTask(clientB, taskName, renamed);

      let staleOpIds: Set<string> | null = null;
      let knownHeadSeq: number | undefined;
      let pagesThisSync = 0;
      let forcedPagesServed = 0;
      let abortedForcedGets = 0;
      let injectedRejections = 0;
      let acceptedReplacementUploads = 0;
      let mixedUploads = 0;
      const forcedStartSeqs: number[] = [];

      await routeSuperSyncOps(clientB.page, async (route: Route) => {
        const request = route.request();
        if (request.method() === 'GET') {
          const url = new URL(request.url());
          const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? 0);
          const isForcedPage = knownHeadSeq !== undefined && sinceSeq < knownHeadSeq;
          if (!isForcedPage) {
            const response = await route.fetch();
            const json = await response.json();
            if (typeof json.latestSeq === 'number') {
              knownHeadSeq = Math.max(knownHeadSeq ?? 0, json.latestSeq);
            }
            await route.fulfill({ response, json });
            return;
          }
          if (pagesThisSync >= PAGES_PER_SYNC) {
            // The network "drops" — also for the provider's own retries.
            abortedForcedGets++;
            await route.abort('failed');
            return;
          }
          if (pagesThisSync === 0) {
            forcedStartSeqs.push(sinceSeq);
          }
          pagesThisSync++;
          forcedPagesServed++;
          url.searchParams.set('limit', '1');
          const response = await route.fetch({ url: url.toString() });
          await route.fulfill({ response });
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
                // The server has already seen a HIGHER counter from this client.
                existingClock: {
                  ...op.vectorClock,
                  [op.clientId]: (op.vectorClock[op.clientId] ?? 0) + 1,
                },
              })),
              latestSeq: knownHeadSeq ?? 0,
            }),
          });
          return;
        }
        await route.continue();
      });

      // 3. Sync repeatedly; each sync's forced download is cut off after
      //    PAGES_PER_SYNC pages. Failed syncs are expected until it completes.
      let syncsNeeded = 0;
      for (let i = 0; i < MAX_SYNCS && acceptedReplacementUploads === 0; i++) {
        if (i > 0 && i <= 2) {
          // Another device keeps working, so B's cursor moves between attempts.
          await clientA.workView.addTask(`Meanwhile-${i}-${testRunId}`);
          await clientA.sync.syncAndWait();
        }
        pagesThisSync = 0;
        syncsNeeded = i + 1;
        try {
          await clientB.sync.syncAndWait();
        } catch {
          console.log(`[Interrupted] sync ${i + 1} failed (network cut)`);
        }
        // Prove each retry resumes, rather than merely counting re-fetched pages.
        expect(forcedStartSeqs).toHaveLength(syncsNeeded);
        if (i > 0) {
          expect(forcedStartSeqs[i]).toBeGreaterThan(forcedStartSeqs[i - 1]);
        }
      }
      console.log(
        `[Interrupted] syncs=${syncsNeeded} forcedPagesServed=${forcedPagesServed} ` +
          `abortedForcedGets=${abortedForcedGets}`,
      );

      // Setup guards: the rejection was injected and the forced download was
      // really cut off at least once, otherwise a pass would prove nothing.
      expect(injectedRejections).toBeGreaterThanOrEqual(1);
      expect(abortedForcedGets).toBeGreaterThanOrEqual(1);
      expect(forcedPagesServed).toBeGreaterThan(PAGES_PER_SYNC);
      // Every rejected upload held only the stale op, so the fake rejection
      // never swallowed an unrelated op.
      expect(mixedUploads).toBe(0);

      // 4. The forced download completed, the stale op was replaced by a
      //    merged op, and that op was accepted by the real server.
      expect(acceptedReplacementUploads).toBeGreaterThanOrEqual(1);
      for (const opId of staleOpIds ?? []) {
        expect(await getOpState(clientB.page, opId)).toBe('rejected');
      }

      // 5. End to end: A receives B's edit.
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
