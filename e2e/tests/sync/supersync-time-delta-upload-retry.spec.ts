import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  expectExactTaskTime,
  getSuperSyncConfig,
  parseSuperSyncRequestBody,
  recordTaskTimeDelta,
  renameTask,
  routeSuperSyncOps,
  unrouteSuperSyncOps,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { readDeltas } from '../../utils/time-delta-retry-helpers';

const blockBackgroundSync = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

test.describe('@supersync time delta upload identity', () => {
  for (const accepted of [true, false]) {
    test(`a ${accepted ? 'stored' : 'rejected'} delta retries after its response is lost`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);
      const clients: SimulatedE2EClient[] = [];
      const title = `ImmutableDelta-${testRunId}`;
      const expectedTime = accepted ? 5000 : 3000;
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        for (const name of ['A', 'B', 'C']) {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.sync.setupSuperSync(config);
          if (name === 'A') await client.workView.addTask(title);
          await client.sync.syncAndWait();
          await waitForTask(client.page, title);
          await client.page.evaluate(blockBackgroundSync);
          await client.page.addInitScript(blockBackgroundSync);
        }
        const [a, b, c] = clients;
        await renameTask(a, title, `${title}-A`);
        await a.sync.syncAndWait();
        await c.sync.syncAndWait();
        if (accepted) {
          await recordTaskTimeDelta(c, title, '2026-10-03', 2000);
          await c.sync.syncAndWait();
        }
        await recordTaskTimeDelta(b, title, '2026-10-03', 3000);
        await expect.poll(async () => (await readDeltas(b)).length).toBe(1);
        const original = (await readDeltas(b))[0].op;

        let stored = false;
        let dropped = false;
        await routeSuperSyncOps(b.page, async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          if (!stored) {
            const upload = parseSuperSyncRequestBody<{
              ops: { id: string; actionType: string }[];
            }>(route.request());
            expect(upload.ops.map((op) => op.id)).toContain(original.id);
            const response = await route.fetch();
            const body = (await response.json()) as {
              results: { opId: string; accepted: boolean }[];
            };
            expect(
              body.results.find((result) => result.opId === original.id)?.accepted,
            ).toBe(accepted);
            if (!accepted) {
              const patch = upload.ops.find(
                (op) => op.actionType === '[TASK] LWW Update',
              );
              expect(patch).toBeDefined();
              expect(
                body.results.find((result) => result.opId === patch?.id)?.accepted,
              ).toBe(true);
            }
            stored = true;
          }
          await route.abort('failed');
          dropped = true;
        });
        // Use the real immediate uploader to send B's delta and rename before
        // B downloads A/C. The server stores both; B sees no acknowledgement.
        if (accepted)
          await b.page.evaluate(() => {
            (globalThis as typeof globalThis & Record<string, boolean>)[
              '__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'
            ] = false;
          });
        await renameTask(b, title, `${title}-B`);
        if (!accepted) await b.sync.clickSyncBtn();
        await expect.poll(() => dropped, { timeout: 30000 }).toBe(true);
        await b.page.evaluate(blockBackgroundSync);
        await expect(b.sync.syncSpinner).not.toBeVisible();
        expect((await readDeltas(b))[0].syncedAt).toBeUndefined();

        // Restart also terminates the immediate uploader's network retry loop.
        // Keep uploads offline while download resolves the rename crossing.
        await b.page.reload();
        await waitForAppReady(b.page);
        await b.sync.clickSyncBtn();
        await expectExactTaskTime(b, title, expectedTime);
        expect((await readDeltas(b))[0].op).toEqual(original);
        await unrouteSuperSyncOps(b.page);

        // Reload across the durable conflict-resolution / upload-ack boundary.
        await b.page.reload();
        await waitForAppReady(b.page);
        for (const client of [b, a, c, b, a, c]) await client.sync.syncAndWait();
        const delivered = (await readDeltas(b)).find(({ op }) => op.id === original.id)!;
        expect(delivered.syncedAt).toBeDefined();
        expect(delivered.rejectedAt).toBeUndefined();
        expect(delivered.op.p).toEqual(original.p);
        if (accepted) expect(delivered.op).toEqual(original);
        else expect(delivered.op.v).not.toEqual(original.v);
        for (const client of clients) {
          await expectExactTaskTime(client, title, expectedTime);
          await client.page.reload();
          await waitForAppReady(client.page);
          await expectExactTaskTime(client, title, expectedTime);
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
