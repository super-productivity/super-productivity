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

/**
 * #10614 path 1. B's pending delta crosses A's rename that reached the server
 * first, so the server rejects it (CONFLICT_CONCURRENT) and the rejection
 * handler rebases it in place (#10214). The rebase proof requires every
 * pending op of the task to be in the rejected upload; a delta B tracks while
 * that upload is in flight is not, so the rejected delta is folded into an
 * absolute whole-task snapshot instead. C's newer pending delta then wins
 * against that snapshot as LOCAL, which can drop B's tracked time.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

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
  // 'delta during upload': B tracks more time while that upload is in flight.
  for (const variant of ['control', 'delta during upload'] as const) {
    test(`${variant}: all tracked time survives the rejected crossing`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      // REPRO #10614 path 1, unfixed: A ends at 17000, not 20000 (B's
      // rejected 3000 is lost). Remove this mark with the fix.
      test.fail(
        variant !== 'control',
        'REPRO #10614 path 1: rejected delta folded and lost',
      );
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
        for (const client of clients) await blockBackgroundSync(client);
        const [a, b, c] = clients;
        const traffic = recordSyncTraffic(clients);

        await recordTaskTimeDelta(b, taskName, taskDate, deltaB);
        await renameTask(a, taskName, renamedTitle);
        await a.sync.syncAndWait();
        // Newer than B's delta, so it wins LWW against a snapshot that folds it.
        await recordTaskTimeDelta(c, taskName, taskDate, deltaC);

        let intercepted = false;
        if (deltaDuringUpload > 0) {
          await routeSuperSyncOps(b.page, async (route) => {
            if (route.request().method() !== 'POST' || intercepted) {
              return route.continue();
            }
            intercepted = true;
            // The upload already fixed its pending set; this op is not in it.
            const before = (await readDeltas(b)).length;
            await recordTaskTimeDelta(b, taskName, taskDate, deltaDuringUpload);
            await expect.poll(async () => (await readDeltas(b)).length).toBe(before + 1);
            await route.continue();
          });
        }
        await b.sync.syncAndWait();
        if (deltaDuringUpload > 0) {
          expect(intercepted).toBe(true);
          await unrouteSuperSyncOps(b.page);
        }
        expect(traffic.rejections).toContain('B:CONFLICT_CONCURRENT');

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
