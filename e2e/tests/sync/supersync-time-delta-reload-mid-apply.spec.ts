import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  expectExactTaskTime,
  getSuperSyncConfig,
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

/**
 * Simulates a crash exactly before a stored pending remote row leaves `pending`
 * (reducer checkpoint → `archive_pending`) or is marked `applied`, or before the
 * in-place re-clock of a pending local time delta (`delta-rebase`): the first such
 * write aborts, and every later IndexedDB write is dropped until the page reloads.
 */
const armCrash = (crashStatuses: string[]): void => {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  g['__E2E_CRASHED'] = false;
  const crash = (store: IDBObjectStore): never => {
    g['__E2E_CRASHED'] = true;
    try {
      store.transaction.abort();
    } catch {
      // already finished
    }
    throw new DOMException('e2e crash', 'AbortError');
  };
  const proto = IDBObjectStore.prototype;
  const origPut = proto.put;
  const origAdd = proto.add;
  const origDelete = proto.delete;
  const origClear = proto.clear;
  proto.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (g['__E2E_CRASHED']) return crash(this);
    const row = value as {
      seq?: number;
      source?: string;
      applicationStatus?: string;
      op?: { a?: string };
    } | null;
    if (
      crashStatuses.includes('delta-rebase') &&
      this.name === 'ops' &&
      row?.source === 'local' &&
      row.op?.a === 'KT' &&
      row.seq !== undefined
    ) {
      return crash(this);
    }
    if (
      this.name === 'ops' &&
      row?.source === 'remote' &&
      crashStatuses.includes(row.applicationStatus ?? '') &&
      row.seq !== undefined
    ) {
      return crash(this);
    }
    return origPut.call(this, value, key);
  } as typeof proto.put;
  proto.add = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (g['__E2E_CRASHED']) return crash(this);
    return origAdd.call(this, value, key);
  } as typeof proto.add;
  proto.delete = function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
    if (g['__E2E_CRASHED']) return crash(this);
    return origDelete.call(this, query);
  } as typeof proto.delete;
  proto.clear = function (this: IDBObjectStore) {
    if (g['__E2E_CRASHED']) return crash(this);
    return origClear.call(this);
  } as typeof proto.clear;
};

test.describe('@supersync time delta reload mid remote apply', () => {
  for (const [crashPoint, crashStatuses] of [
    ['reducer checkpoint', ['archive_pending', 'applied']],
    ['markApplied', ['applied']],
    // Conflict resolution writes the pending remote row and merge op in one
    // batch, then re-clocks the kept local delta in a separate write.
    ['kept-delta re-clock', ['delta-rebase']],
  ] as const) {
    for (const accepted of [true, false]) {
      test(`a ${accepted ? 'stored' : 'rejected'} delta survives a reload before the ${crashPoint}`, async ({
        browser,
        baseURL,
        testRunId,
      }) => {
        test.setTimeout(300000);
        const clients: SimulatedE2EClient[] = [];
        const title = `MidApply-${testRunId}`;
        // C's unsynced 1000 is concurrent with everything B uploads after the crash.
        const expectedTime = accepted ? 6000 : 4000;
        try {
          const config = getSuperSyncConfig(await createTestUser(testRunId));
          for (const name of ['A', 'B', 'C']) {
            const client = await createSimulatedClient(
              browser,
              baseURL!,
              name,
              testRunId,
            );
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

          let stored = false;
          let dropped = false;
          await routeSuperSyncOps(b.page, async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            if (!stored) {
              await route.fetch();
              stored = true;
            }
            await route.abort('failed');
            dropped = true;
          });
          await b.page.evaluate(() => {
            (globalThis as typeof globalThis & Record<string, boolean>)[
              '__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'
            ] = false;
          });
          await renameTask(b, title, `${title}-B`);
          await expect.poll(() => dropped, { timeout: 30000 }).toBe(true);
          await b.page.evaluate(blockBackgroundSync);
          await expect(b.sync.syncSpinner).not.toBeVisible();
          expect((await readDeltas(b))[0].syncedAt).toBeUndefined();

          await recordTaskTimeDelta(c, title, '2026-10-03', 1000);
          await b.page.reload();
          await waitForAppReady(b.page);
          await b.page.evaluate(armCrash, [...crashStatuses]);
          await b.sync.clickSyncBtn();
          await expect
            .poll(() =>
              b.page.evaluate(
                () =>
                  (globalThis as typeof globalThis & Record<string, unknown>)[
                    '__E2E_CRASHED'
                  ],
              ),
            )
            .toBe(true);
          await unrouteSuperSyncOps(b.page);
          await b.page.reload();
          await waitForAppReady(b.page);

          for (const client of [b, a, c, b, a, c]) await client.sync.syncAndWait();
          const fresh = await createSimulatedClient(
            browser,
            baseURL!,
            'Fresh',
            testRunId,
          );
          clients.push(fresh);
          await fresh.sync.setupSuperSync(config);
          await fresh.sync.syncAndWait();
          for (const client of clients) {
            await waitForTask(client.page, `${title}-B`);
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
  }
});
