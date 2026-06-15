import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  renameTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

// Reads the op-log store directly and counts terminally-rejected ops (rejectedAt
// set). This is the precise, timing-independent discriminator for #8331: the
// transient blip must NOT have rejected the pending edit.
const countRejectedOps = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('SUP_OPS');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains('ops')) return 0;
      const entries = await new Promise<{ rejectedAt?: number }[]>((resolve, reject) => {
        const tx = db.transaction('ops', 'readonly');
        const r = tx.objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result as { rejectedAt?: number }[]);
        r.onerror = () => reject(r.error);
      });
      return entries.filter((e) => e.rejectedAt).length;
    } finally {
      db.close();
    }
  });

/**
 * Regression: transient download failure during rejected-ops resolution must
 * NOT permanently drop the user's pending local edit. (#8331)
 *
 * Background: when an upload is rejected with CONFLICT_CONCURRENT, the client
 * downloads remote ops to resolve the conflict. A network blip during that
 * nested download used to call markRejected() on the still-pending local op —
 * which is terminal (rejectedAt is never cleared), so the edit stayed applied
 * locally but never reached other devices. The fix leaves the op pending so it
 * re-resolves on the next sync.
 *
 * Discriminator: after the blip, B's pending edit must NOT be terminally
 * rejected (op-log has zero rejectedAt ops) — with the bug the catch called
 * markRejected() so that count is >= 1. End-to-end: once the fault clears, B's
 * edit resolves and both clients converge to the same title; with the bug B's
 * edit is dropped and the clients diverge.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-rejected-ops-transient-download-8331.spec.ts
 */
test.describe('@supersync Rejected-ops transient download (#8331)', () => {
  test('a network blip during conflict-resolution download does not drop the pending edit', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates a task and syncs it up.
      const taskName = `Transient-8331-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task.
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 3. Both clients edit the SAME task "offline" (no sync between edits).
      //    A edits first, then B — so B's op carries the later LWW timestamp.
      await renameTask(clientA, taskName, `${taskName}-ModifiedByA`);
      await renameTask(clientB, taskName, `${taskName}-ModifiedByB`);

      // 4. A syncs first — A's concurrent edit is now DETERMINISTICALLY on the
      //    server. This test runs with WebSocket and immediate-upload blocked
      //    (no enableWebSocket), so the only ops that ever reach the server are
      //    the ones an explicit syncAndWait() pushes — no background race.
      await clientA.sync.syncAndWait();

      // 5. Arm B's network with three phase-distinguished faults so the
      //    CONFLICT_CONCURRENT rejection AND the resolution-download failure the
      //    fix guards fire deterministically.
      //
      //    The sync engine downloads before it uploads (sync-wrapper.service:
      //    downloadRemoteOps → uploadPendingOps). A's concurrent op is now on
      //    the server, so B's pre-upload download would normally deliver it, B
      //    would MERGE it, and B would then upload a dominating op the server
      //    ACCEPTS (200) — the rejection path is never reached. So we strip that
      //    pre-upload download (a).
      //
      //    But stripping the download alone is NOT enough, and that is what kept
      //    this test red on every CI run (abortedResolutionGets stayed 0 — see
      //    run 27469179025). With the download stripped, B's upload IS rejected
      //    CONFLICT_CONCURRENT as intended — but the ops-upload conflict comes
      //    back as HTTP 200 whose body carries `results[].errorCode ===
      //    'CONFLICT_CONCURRENT'` (NOT a 409 — only /api/sync/snapshot uses 409),
      //    and that same body PIGGYBACKS the conflicting remote op in `newOps`.
      //    The upload service applies those piggybacked ops and LWW-resolves the
      //    conflict in-place (operation-log-upload.service.ts), so by the time
      //    handleRejectedOps() runs, B's op is already resolved: the separate
      //    resolution-download (RejectedOpsHandlerService._resolveConcurrent-
      //    Modifications → downloadCallback, the GET the #8331 fix guards) is
      //    never issued. We therefore also strip `newOps` from the rejection
      //    body (b): with no piggybacked ops to resolve from, the client falls
      //    back to the resolution-download GET — which we then abort (c).
      //
      //    (Stripping `newOps` is not a contrived path: the server only
      //    piggybacks up to PIGGYBACK_LIMIT (500) ops, so a conflict whose remote
      //    op falls beyond that window arrives WITHOUT it in `newOps` and takes
      //    exactly this resolution-download fallback in production. We force the
      //    condition rather than generating 500+ ops.)
      //
      //    (a) Pre-upload download (GET before B's first POST): return the REAL
      //        server response with its ops STRIPPED, so B downloads nothing and
      //        never merges A's edit. B then uploads its ORIGINAL (concurrent)
      //        op and the real server returns a real, server-computed
      //        CONFLICT_CONCURRENT — this stays a genuine vector-clock conflict,
      //        not a mock. (Emptying the real response, rather than fabricating
      //        one, keeps the test honest if DownloadOpsResponse changes shape.)
      //    (b) Upload POST: forward it to the real server (so the rejection stays
      //        server-computed), then strip `newOps`/`hasMorePiggyback` from the
      //        response body so the client cannot resolve the conflict from
      //        piggyback and must fall back to the resolution-download GET.
      //    (c) Resolution download (every GET after the POST): fail it. The
      //        provider retries transient fetch failures (SUPERSYNC_WEB_MAX_RETRIES),
      //        so abort EVERY one — a single abort would be silently recovered
      //        and never reach the catch the fix touches.
      //
      //    The glob must match the real ops URLs (`/api/sync/ops` and
      //    `/api/sync/ops?<query>`) — `**/api/sync/ops/**` would match NEITHER
      //    (it requires a literal `/` after `ops`).
      let sawUploadAttempt = false;
      let abortedResolutionGets = 0;
      let strippedPreUploadDownloads = 0;
      let strippedConflictPiggybacks = 0;
      await clientB.page.route('**/api/sync/ops*', async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          if (sawUploadAttempt) {
            // (c) resolution download — fail past the retry budget.
            abortedResolutionGets++;
            await route.abort('failed');
            return;
          }
          // (a) pre-upload download — deliver the real response minus its ops so
          //     B never merges A's concurrent edit. Pin latestSeq back to the
          //     request's sinceSeq so B's stored lastServerSeq is NOT advanced
          //     past A's edit: the client persists latestSeq even on an empty
          //     download (operation-log-sync.service.ts ~660), and if B recorded
          //     itself caught-up past A's edit it would never re-download it on
          //     the post-fault clean sync and the two clients could not converge.
          const sinceSeq = Number(
            new URL(route.request().url()).searchParams.get('sinceSeq') ?? 0,
          );
          const response = await route.fetch();
          const json = await response.json();
          json.ops = [];
          json.hasMore = false;
          json.latestSeq = sinceSeq;
          strippedPreUploadDownloads++;
          await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify(json),
          });
          return;
        }
        if (method === 'POST') {
          // (b) Forward the upload to the real server for a genuine, server-
          //     computed CONFLICT_CONCURRENT, then strip the piggybacked
          //     conflicting ops from the rejection so the client cannot resolve
          //     in-place and must issue the resolution-download GET (c) aborts.
          sawUploadAttempt = true;
          const response = await route.fetch();
          const json = await response.json();
          if (Array.isArray(json.newOps) && json.newOps.length > 0) {
            json.newOps = [];
            json.hasMorePiggyback = false;
            strippedConflictPiggybacks++;
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

      // 6. Client B syncs — the real server rejects its upload
      //    CONFLICT_CONCURRENT, then the resolution download fails past its retry
      //    budget. Sync reports an error; that is expected. The edit must remain
      //    pending, NOT be rejected.
      try {
        await clientB.sync.syncAndWait();
      } catch {
        // Expected: the transient download failure surfaces as a sync error.
        console.log('[Test #8331] B sync failed as expected during the blip');
      }
      // Setup guards: all three faults must actually have fired, otherwise the
      // catch under test was never reached and a green result would be vacuous.
      // strippedConflictPiggybacks proves the rejection was genuinely
      // CONFLICT_CONCURRENT (only a conflict response carries newOps) AND that
      // the piggyback path was closed off so the resolution-download GET runs.
      expect(strippedPreUploadDownloads).toBeGreaterThanOrEqual(1);
      expect(strippedConflictPiggybacks).toBeGreaterThanOrEqual(1);
      expect(abortedResolutionGets).toBeGreaterThanOrEqual(1);

      // Precise discriminator (timing-independent): the blip must not have
      // terminally rejected B's pending edit. With the bug, the catch called
      // markRejected() so this is >= 1; with the fix the edit stays pending -> 0.
      expect(await countRejectedOps(clientB.page)).toBe(0);

      // 7. Remove the fault and let B sync cleanly — the still-pending edit
      //    resolves and uploads (the merged op may need a second flush).
      await clientB.page.unroute('**/api/sync/ops*');
      await clientB.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // 8. End-to-end recovery proof: after pulling B's now-uploaded edit, both
      //    clients converge to the SAME title. With the bug, B's edit was
      //    dropped on the blip, so it never reaches A and the two diverge.
      //    (Assert convergence, not a specific winner: the merged op snapshots
      //    B's local state, so the resolved value is robust to LWW direction.)
      await clientA.sync.syncAndWait();
      const titleSel = 'task:not(.ng-animating) .task-title';
      const titleA = await clientA.page.locator(titleSel).first().textContent();
      const titleB = await clientB.page.locator(titleSel).first().textContent();
      expect(titleA?.trim()).toBeTruthy();
      expect(titleA).toBe(titleB);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
