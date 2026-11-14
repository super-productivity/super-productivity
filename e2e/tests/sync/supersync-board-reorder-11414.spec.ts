import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { BoardCfg } from '../../../src/app/features/boards/boards.model';
import type { CompactOperationLogEntry } from '../../../src/app/op-log/persistence/compact/compact-operation.types';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  createView,
  fillViewEditor,
  openViewEditor,
  readBoard,
  saveViewEditor,
} from '../../utils/view-helpers';
import { flushPendingWrites as flush, waitForAppReady } from '../../utils/waits';

type Row = CompactOperationLogEntry;

const rows = async (page: Page): Promise<Row[]> => {
  await flush(page);
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Row[]>((resolve, reject) => {
        const request = db.transaction('ops').objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
};

const pending = (entries: Row[]): Row[] =>
  entries.filter((row) => row.source === 'local' && !row.syncedAt && !row.rejectedAt);

const visibleIds = (page: Page, panel: number): Promise<string[]> =>
  page
    .locator('boards board-panel')
    .nth(panel)
    .locator('task:not(.cdk-drag-placeholder)')
    .evaluateAll((tasks) => tasks.map((task) => task.getAttribute('data-task-id')!));

const board = async (page: Page, id: string): Promise<BoardCfg> => {
  const value = await readBoard(page, id);
  expect(value).toBeDefined();
  return value as BoardCfg;
};

/** Persist the same controls across reloads; only explicit syncs may run. */
const manualSyncOnly = async (page: Page): Promise<void> => {
  const block = (): void => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  };
  await page.addInitScript(block);
  await page.evaluate(block);
};

/** One cycle, without choosing a conflict-dialog winner or retrying pending ops. */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  await flush(client.page);
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  let outcome = 'pending';
  await expect
    .poll(async () => {
      outcome = (await client.sync.conflictDialog.isVisible())
        ? 'conflict-dialog'
        : (await client.sync.hasSyncError())
          ? 'error'
          : !(await client.sync.syncSpinner.isVisible()) &&
              (await client.sync.syncConfirmedIcon.isVisible())
            ? 'in-sync'
            : 'pending';
      return outcome;
    })
    .not.toBe('pending');
  expect(outcome).toBe('in-sync');
};

const move = async (
  client: SimulatedE2EClient,
  panel: number,
  index: number,
  direction: 'Up' | 'Down',
  expected: string[],
): Promise<void> => {
  await client.page
    .locator('boards board-panel')
    .nth(panel)
    .locator('task')
    .nth(index)
    .focus();
  await client.page.keyboard.press(`Control+Shift+Arrow${direction}`);
  await expect.poll(() => visibleIds(client.page, panel)).toEqual(expected);
  await flush(client.page);
};

const pendingBoardOp = async (page: Page, entityId: string): Promise<Row> => {
  const operations = pending(await rows(page)).filter(
    (row) => row.op.e === 'BOARD' && row.op.d === entityId,
  );
  expect(operations).toHaveLength(1);
  return operations[0];
};

const expectConcurrent = (a: Row, b: Row): void => {
  const keys = [...new Set([...Object.keys(a.op.v), ...Object.keys(b.op.v)])];
  expect(keys.some((key) => (a.op.v[key] || 0) > (b.op.v[key] || 0))).toBe(true);
  expect(keys.some((key) => (a.op.v[key] || 0) < (b.op.v[key] || 0))).toBe(true);
};

const snapshot = async (
  client: SimulatedE2EClient,
  boardId: string,
): Promise<unknown> => ({
  board: await board(client.page, boardId),
  visible: [await visibleIds(client.page, 0), await visibleIds(client.page, 1)],
  pending: pending(await rows(client.page)).map((row) => row.op.id),
  boardOps: (await rows(client.page)).filter((row) => row.op.e === 'BOARD'),
});

test.describe('@supersync board reorder reproduction (#11414)', () => {
  for (const scenario of ['A newer', 'B newer', 'three concurrent operations'] as const) {
    test(scenario, async ({ browser, baseURL, testRunId }, testInfo) => {
      test.setTimeout(240000);
      const clients: SimulatedE2EClient[] = [];
      const seedTime = Date.now();
      const evidence: Record<string, unknown> = {};
      const diagnostics: string[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const makeClient = async (name: string): Promise<SimulatedE2EClient> => {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId, {
            // Install the clock before Angular/RxJS creates timers. Later changes
            // control Date only, without mixing native and instrumented timers.
            seedBeforeBoot: (page) => page.clock.setFixedTime(seedTime),
          });
          clients.push(client);
          client.page.on('console', (message) => {
            if (
              /Cannot create local-win|archive\/delete wins|Skipping concurrent/.test(
                message.text(),
              )
            ) {
              diagnostics.push(`${name}: ${message.text()}`);
            }
          });
          await client.sync.setupSuperSync(config);
          await manualSyncOnly(client.page);
          return client;
        };
        const a = await makeClient('A');
        for (const title of ['T1', 'T2', 'T3']) await a.workView.addTask(title);
        await createView(a.page, {
          title: `Reorder-${testRunId}`,
          sections: [
            { title: 'First', sort: 'Manual' },
            { title: 'Second', sort: 'Manual' },
          ],
        });
        const boardId = a.page.url().match(/#\/boards\/([^/?]+)/)![1];
        const panel = scenario === 'three concurrent operations' ? 1 : 0;
        const initial = await visibleIds(a.page, panel);
        expect(initial).toHaveLength(3);
        expect(new Set(initial).size).toBe(3);
        // Establish an explicit stored manual order through real keyboard actions.
        const aOrder = [initial[0], initial[2], initial[1]];
        const bOrder = [initial[1], initial[0], initial[2]];
        await move(a, panel, 2, 'Up', aOrder);
        await move(a, panel, 1, 'Down', initial);
        const baseline = await board(a.page, boardId);
        const panelId = baseline.panels[panel].id;
        expect(panelId).not.toBe(boardId);
        expect(baseline.panels[panel].taskIds).toEqual(initial);
        await sync(a);
        const b = await makeClient('B');
        await b.page.goto(`/#/boards/${boardId}`);
        await expect.poll(() => visibleIds(b.page, panel)).toEqual(initial);
        expect((await board(b.page, boardId)).panels[panel].taskIds).toEqual(initial);
        await sync(a);
        const time = Date.now() + 60000;
        evidence.baseline = { boardId, panelId, initial, aOrder, bOrder };

        if (scenario === 'three concurrent operations') {
          const c = await makeClient('C');
          await c.page.goto(`/#/boards/${boardId}`);
          await expect.poll(() => visibleIds(c.page, panel)).toEqual(initial);
          const rename = async (
            client: SimulatedE2EClient,
            title: string,
          ): Promise<void> => {
            const dialog = await openViewEditor(client.page);
            await fillViewEditor(client.page, dialog, { title });
            await saveViewEditor(dialog);
            await flush(client.page);
          };
          await a.page.clock.setFixedTime(time);
          await rename(a, 'Older board edit');
          await c.page.clock.setFixedTime(time + 1000);
          await move(c, panel, 2, 'Up', aOrder);
          await b.page.clock.setFixedTime(time + 2000);
          await rename(b, 'Newer board edit');
          const aOp = await pendingBoardOp(a.page, boardId);
          const bOp = await pendingBoardOp(b.page, boardId);
          const cOp = await pendingBoardOp(c.page, panelId);
          expect(aOp.op.t).toBe(time);
          expect(cOp.op.t).toBe(time + 1000);
          expect(bOp.op.t).toBe(time + 2000);
          for (const [left, right] of [
            [aOp, bOp],
            [aOp, cOp],
            [bOp, cOp],
          ]) {
            expectConcurrent(left, right);
          }
          evidence.concurrent = { aOp, bOp, cOp };
          // A applies C's reorder before B resolves the two board edits locally.
          await sync(c);
          await sync(a);
          expect((await board(a.page, boardId)).panels[panel].taskIds).toEqual(aOrder);
          await sync(b);
        } else {
          const aTime = scenario === 'A newer' ? time + 1000 : time;
          const bTime = scenario === 'B newer' ? time + 1000 : time;
          await a.page.clock.setFixedTime(aTime);
          await move(a, panel, 2, 'Up', aOrder);
          const aOp = await pendingBoardOp(a.page, panelId);
          await sync(a);
          expect(pending(await rows(a.page))).toHaveLength(0);
          // B edits without downloading A's reorder. Its captured clock proves it.
          await b.page.clock.setFixedTime(bTime);
          await move(b, panel, 0, 'Down', bOrder);
          const bOp = await pendingBoardOp(b.page, panelId);
          expect(aOp.op.t).toBe(aTime);
          expect(bOp.op.t).toBe(bTime);
          expectConcurrent(aOp, bOp);
          for (const [operation, order] of [
            [aOp, aOrder],
            [bOp, bOrder],
          ] as const) {
            expect(operation.op).toMatchObject({ e: 'BOARD', d: panelId, o: 'UPD' });
            expect(operation.op.p).toMatchObject({
              actionPayload: { panelId, taskIds: order },
            });
          }
          evidence.concurrent = { aOp, bOp };
          await sync(b);
          await sync(a);
        }

        evidence.afterFirstCrossing = await Promise.all(
          clients.map((client) => snapshot(client, boardId)),
        );
        // Distinguish a lasting mismatch from one repaired by the next sync.
        for (let round = 0; round < 2; round++) {
          for (const client of clients) await sync(client);
        }
        evidence.afterExtraSyncs = await Promise.all(
          clients.map((client) => snapshot(client, boardId)),
        );
        for (const client of clients) {
          await client.page.reload();
          await waitForAppReady(client.page, { routeRegex: /#\/boards\/[^/]+$/ });
          await expect(client.page.locator('boards board-panel')).toHaveCount(2);
        }
        evidence.afterReload = await Promise.all(
          clients.map((client) => snapshot(client, boardId)),
        );
        const expected = scenario === 'B newer' ? bOrder : aOrder;
        for (const client of clients) {
          expect
            .soft((await board(client.page, boardId)).panels[panel].taskIds)
            .toEqual(expected);
          expect.soft(await visibleIds(client.page, panel)).toEqual(expected);
          expect.soft(pending(await rows(client.page))).toHaveLength(0);
          if (scenario === 'three concurrent operations') {
            expect
              .soft((await board(client.page, boardId)).title)
              .toBe('Newer board edit');
          }
        }
      } finally {
        evidence.diagnostics = diagnostics;
        const evidencePath = testInfo.outputPath('board-reorder-evidence.json');
        await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
        await testInfo.attach('board-reorder-evidence', {
          path: evidencePath,
          contentType: 'application/json',
        });
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
