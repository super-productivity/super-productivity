import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  expectExactTaskTime,
  getSuperSyncConfig,
  getTaskTitleFromState,
  recordTaskTimeDelta,
  renameTask,
  routeSuperSyncOps,
  unrouteSuperSyncOps,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { readDeltas } from '../../utils/time-delta-retry-helpers';
import { blockBackgroundSync } from '../../utils/time-preserving-resolution-helpers';

/**
 * #10614 path 1. B's pending delta crosses A's rename that reached the server
 * first, so the server rejects it (CONFLICT_CONCURRENT) and the rejection
 * handler rebases it in place (#10214). A delta tracked while that upload is
 * in flight is not in the rejected batch. It used to fail the rebase proof, so
 * the rejected delta was folded into an absolute whole-task snapshot that C's
 * newer pending delta then overwrote as LOCAL, dropping B's tracked time.
 * 'rename rejected' is the opposite direction: A's rename is the rejected upload.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const recordSyncTraffic = (
  clients: SimulatedE2EClient[],
): { rejections: string[]; forcedDownloads: string[] } => {
  const rejections: string[] = [];
  const forcedDownloads: string[] = [];
  for (const client of clients) {
    client.page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        request.url().includes('/api/sync/ops?') &&
        new URL(request.url()).searchParams.get('sinceSeq') === '0'
      ) {
        forcedDownloads.push(client.clientName);
      }
    });
    client.page.on('response', async (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/sync/ops')
      ) {
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
      for (const result of results) {
        if (isRecord(result) && result.accepted === false) {
          rejections.push(`${client.clientName}:${String(result.errorCode)}`);
        }
      }
    });
  }
  return { rejections, forcedDownloads };
};

test.describe('@supersync time delta tracked while its crossing upload is rejected', () => {
  // 'control': the rejected upload holds every pending op of the task (#10214 rebase).
  // Otherwise the rejected client tracks more time while that upload is in flight.
  for (const variant of ['control', 'delta during upload', 'rename rejected'] as const) {
    test(`${variant}: all tracked time survives the rejected crossing`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);
      const taskDate = '2026-07-13';
      const initialTime = 10000;
      const deltaB = 3000;
      const deltaDuringUpload = variant === 'control' ? 0 : 2000;
      const deltaC = 5000;
      const expectedTime = initialTime + deltaB + deltaDuringUpload + deltaC;
      const taskName = `RejectedUploadDelta-${testRunId}`;
      const renamedTitle = `${taskName}-A`;
      const clients: SimulatedE2EClient[] = [];

      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        for (const name of ['A', 'B', 'C']) {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.sync.setupSuperSync(config);
          if (name === 'A') {
            await client.workView.addTask(taskName);
            await waitForTask(client.page, taskName);
            await recordTaskTimeDelta(client, taskName, taskDate, initialTime);
          }
          await client.sync.syncAndWait();
          await waitForTask(client.page, taskName);
          await expectExactTaskTime(client, taskName, initialTime);
        }
        for (const client of clients) await client.page.evaluate(blockBackgroundSync);
        const [a, b, c] = clients;
        const traffic = recordSyncTraffic(clients);
        const [winner, loser] = variant === 'rename rejected' ? [b, a] : [a, b];

        await recordTaskTimeDelta(b, taskName, taskDate, deltaB);
        await renameTask(a, taskName, renamedTitle);
        await winner.sync.syncAndWait();
        // Newer than the loser's op, so it wins LWW against a snapshot that folds it.
        await recordTaskTimeDelta(c, taskName, taskDate, deltaC);

        let intercepted = false;
        let interceptError: unknown;
        if (deltaDuringUpload > 0) {
          await routeSuperSyncOps(loser.page, async (route) => {
            if (route.request().method() !== 'POST' || intercepted) {
              return route.continue();
            }
            intercepted = true;
            try {
              // The upload already fixed its pending set; this op is not in it.
              const before = (await readDeltas(loser)).length;
              await recordTaskTimeDelta(loser, taskName, taskDate, deltaDuringUpload);
              await expect
                .poll(async () => (await readDeltas(loser)).length)
                .toBe(before + 1);
            } catch (error) {
              interceptError = error;
            } finally {
              // A held upload would otherwise hang the sync until the test timeout.
              await route.continue();
            }
          });
        }
        await loser.sync.syncAndWait();
        if (deltaDuringUpload > 0) {
          await unrouteSuperSyncOps(loser.page);
          if (interceptError) throw interceptError;
          expect(intercepted).toBe(true);
        }
        // The response listener parses the body asynchronously.
        await expect
          .poll(() => traffic.rejections)
          .toContain(`${loser.clientName}:CONFLICT_CONCURRENT`);
        // The in-place rebase needs no seq-0 download; the snapshot fallback
        // (#10614 before the fix) forced one on the rejected client.
        expect(traffic.forcedDownloads).not.toContain(loser.clientName);

        await c.sync.syncAndWait();
        for (let round = 0; round < 2; round++) {
          for (const client of clients) await client.sync.syncAndWait();
        }

        const fresh = await createSimulatedClient(browser, baseURL!, 'Fresh', testRunId);
        clients.push(fresh);
        await fresh.sync.setupSuperSync(config);
        await fresh.sync.syncAndWait();

        test.info().annotations.push(
          { type: 'server rejections', description: traffic.rejections.join(', ') },
          {
            type: 'forced full downloads',
            description: traffic.forcedDownloads.join(', ') || 'none',
          },
        );

        for (const client of clients) {
          await waitForTask(client.page, renamedTitle);
          await expectExactTaskTime(client, taskName, expectedTime);
          await expect
            .poll(() => getTaskTitleFromState(client, taskName), { timeout: 30000 })
            .toBe(renamedTitle);
          await client.page.reload();
          await waitForAppReady(client.page);
          await expectExactTaskTime(client, taskName, expectedTime);
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
