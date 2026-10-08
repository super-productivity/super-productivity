import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { NoteState } from '../../../src/app/features/note/note.model';
import type { CompactOperationLogEntry } from '../../../src/app/op-log/persistence/compact/compact-operation.types';
import { expect, test } from '../../fixtures/supersync.fixture';
import { NotePage } from '../../pages/note.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  routeSuperSyncOps,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

// Seed through the existing store seam; both concurrent changes use the real UI.
type Row = CompactOperationLogEntry;
type Context = 'project' | 'Today';
interface Snapshot {
  note: NoteState;
  projectOrder: string[];
}
const PROJECT = 'INBOX_PROJECT';
const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate((projectId) => {
    type State = {
      note: NoteState;
      projects: { entities: Record<string, { noteIds: string[] }> };
    };
    let state!: State;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (s: State) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return { note: state.note, projectOrder: state.projects.entities[projectId].noteIds };
  }, PROJECT);
const rows = (page: Page): Promise<Row[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<Row[]>((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
const pending = (entries: Row[]): Row[] =>
  entries.filter((r) => r.source === 'local' && !r.syncedAt && !r.rejectedAt);
const replacements = (entries: Row[]): string[] =>
  entries
    .filter((r) => ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(r.op.o))
    .map((r) => r.op.id)
    .sort();

// Strict S2 pattern: real successful download, then no error or dataset choice.
const syncOutcome = async (client: SimulatedE2EClient): Promise<string> => {
  const downloaded = client.page.waitForResponse(
    (r) => r.url().includes('/api/sync/ops') && r.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  let outcome = 'pending';
  await expect
    .poll(
      async () => {
        outcome = (await client.sync.conflictDialog.isVisible())
          ? 'conflict-dialog'
          : (await client.sync.hasSyncError())
            ? 'error'
            : !(await client.sync.syncSpinner.isVisible()) &&
                (await client.sync.syncCheckIcon
                  .filter({ hasText: /^done_all$/ })
                  .isVisible())
              ? 'in-sync'
              : 'pending';
        return outcome;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  return outcome;
};
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  expect(await syncOutcome(client)).toBe('in-sync');
};
const openNotes = async (client: SimulatedE2EClient, context: Context): Promise<void> => {
  await client.page.goto(
    `/#/${context === 'project' ? `project/${PROJECT}` : 'tag/TODAY'}/tasks`,
  );
  await client.workView.waitForTaskList();
  await new NotePage(client.page).ensureNotesVisible();
  await expect(client.page.locator('notes .notes')).toBeVisible();
};
const drag = async (client: SimulatedE2EClient, context: Context): Promise<string[]> => {
  await openNotes(client, context);
  const state = await snapshot(client.page);
  const order = context === 'project' ? state.projectOrder : state.note.todayOrder;
  const [first, second, ...rest] = order;
  const source = client.page.locator(`#n-${first} .handle-drag`);
  const target = client.page.locator(`#n-${second}`);
  await source.hover();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Note drag targets missing');
  const halfSourceWidth = from.width / 2;
  const halfSourceHeight = from.height / 2;
  const halfTargetWidth = to.width / 2;
  const x = from.x + halfSourceWidth;
  const y = from.y + halfSourceHeight;
  await client.page.mouse.move(x, y);
  await client.page.mouse.down();
  await client.page.mouse.move(x, y + 8);
  await expect(client.page.locator('.cdk-drag-preview')).toBeVisible();
  await client.page.mouse.move(to.x + halfTargetWidth, to.y + to.height - 4, {
    steps: 20,
  });
  await client.page.mouse.up();
  await expect(client.page.locator('.cdk-drag-preview')).toBeHidden();
  const expected = [second, first, ...rest];
  await expect
    .poll(async () => {
      const current = await snapshot(client.page);
      return context === 'project' ? current.projectOrder : current.note.todayOrder;
    })
    .toEqual(expected);
  return expected;
};
const toggle = async (
  client: SimulatedE2EClient,
  id: string,
  pin: boolean,
): Promise<void> => {
  // Pin is reachable in the project while the other client reorders Today.
  await openNotes(client, 'project');
  const note = client.page.locator(`#n-${id}`);
  await note.hover();
  const button = pin
    ? note
        .locator('button')
        .filter({ has: client.page.locator('mat-icon', { hasText: /^wb_sunny$/ }) })
    : note.locator('button:has(mat-icon[data-mat-icon-name="remove_today"])');
  await button.click();
  await expect
    .poll(async () => (await snapshot(client.page)).note.entities[id]?.isPinnedToToday)
    .toBe(pin);
};

const scenarios = [
  { pendingOrder: true, incomingNewer: true, retry: false },
  { pendingOrder: true, incomingNewer: false, retry: false },
  { pendingOrder: false, incomingNewer: true, retry: false },
  { pendingOrder: false, incomingNewer: false, retry: false },
  { pendingOrder: true, incomingNewer: true, retry: true },
];

for (const { pendingOrder, incomingNewer, retry } of scenarios) {
  test(`@supersync Today pin / local-${pendingOrder ? 'order' : 'pin'} / incoming-${incomingNewer ? 'newer' : 'older'}${retry ? ' / lost upload response' : ''}`, async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    const clients: SimulatedE2EClient[] = [];
    const evidence: Record<string, unknown> = {};
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const makeClient = async (name: string): Promise<SimulatedE2EClient> => {
        const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
        clients.push(client);
        await client.sync.setupSuperSync(config);
        await client.page.addInitScript(() => {
          const flags = window as unknown as Record<string, unknown>;
          flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
          flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
          flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
        });
        return client;
      };
      const a = await makeClient('A');
      const ids = ['target', 'sibling', 'witness', 'today-only'].map(
        (id) => `${id}-${testRunId}`,
      );
      await a.page.evaluate(
        async ({ ids: noteIds, projectId }) => {
          const store = (
            window as unknown as {
              __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
            }
          ).__e2eTestHelpers.store;
          for (const [index, id] of [...noteIds.entries()].reverse()) {
            store.dispatch({
              type: '[Note] Add Note',
              note: {
                id,
                projectId: index === 3 ? null : projectId,
                isPinnedToToday: index !== 0,
                content: `Synthetic note ${index}`,
                created: 100,
                modified: 100,
              },
              isPreventFocus: true,
              meta: {
                isPersistent: true,
                entityType: 'NOTE',
                entityId: id,
                opType: 'CRT',
              },
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
        { ids, projectId: PROJECT },
      );
      await sync(a);
      const b = await makeClient('B');
      await sync(b);
      await sync(a);
      const before = await snapshot(a.page);
      expect(await snapshot(b.page)).toEqual(before);
      expect(before.projectOrder).toEqual(ids.slice(0, 3));
      expect(before.note.todayOrder).toEqual(ids.slice(1));
      const fullStateIds = new Set([
        ...replacements(await rows(a.page)),
        ...replacements(await rows(b.page)),
      ]);
      const orderClient = pendingOrder ? a : b;
      const pinClient = pendingOrder ? b : a;
      const reordered = [ids[2], ids[1], ids[3]];
      const perform = async (client: SimulatedE2EClient): Promise<void> => {
        if (client === orderClient)
          expect(await drag(client, 'Today')).toEqual(reordered);
        else await toggle(client, ids[0], true);
        await expect.poll(async () => pending(await rows(client.page)).length).toBe(1);
      };
      // Change real UI action order, not timestamps or stored operation rows.
      await perform(incomingNewer ? a : b);
      await perform(incomingNewer ? b : a);
      const order = pending(await rows(orderClient.page))[0].op;
      const update = pending(await rows(pinClient.page))[0].op;
      expect(order).toMatchObject({
        a: 'NO',
        o: 'MOV',
        e: 'NOTE',
        d: reordered[0],
        ds: reordered,
      });
      expect(order.p).toEqual({
        actionPayload: {
          ids: reordered,
          activeContextType: 'TAG',
          activeContextId: 'TODAY',
        },
        entityChanges: [],
      });
      expect(update).toMatchObject({
        a: 'NU',
        o: 'UPD',
        e: 'NOTE',
        d: ids[0],
        ds: [ids[0]],
      });
      expect(update.p).toEqual({
        actionPayload: { note: { id: ids[0], changes: { isPinnedToToday: true } } },
        entityChanges: [],
      });
      expect(order.ds).not.toContain(ids[0]);
      const local = pendingOrder ? order : update;
      const remote = pendingOrder ? update : order;
      expect(remote.t > local.t).toBe(incomingNewer);
      expect(remote.t).not.toBe(local.t);
      const keys = new Set([...Object.keys(local.v), ...Object.keys(remote.v)]);
      expect([...keys].some((k) => (local.v[k] || 0) > (remote.v[k] || 0))).toBe(true);
      expect([...keys].some((k) => (local.v[k] || 0) < (remote.v[k] || 0))).toBe(true);
      evidence.beforeCrossing = {
        order,
        update,
        a: await snapshot(a.page),
        b: await snapshot(b.page),
      };
      const expectedEntities = {
        ...before.note.entities,
        [ids[0]]: { ...before.note.entities[ids[0]], isPinnedToToday: true },
      };
      let lostResponse = false;
      if (retry) {
        await routeSuperSyncOps(a.page, async (route) => {
          if (route.request().method() === 'POST' && !lostResponse) {
            const accepted = await route.fetch();
            expect(accepted.ok()).toBe(true);
            lostResponse = true;
            await route.abort('connectionreset');
          } else await route.continue();
        });
      }
      await sync(b);
      await sync(a);
      await sync(b);
      await sync(a);
      expect(lostResponse).toBe(retry);
      const states: Record<string, Snapshot> = {};
      evidence.states = states;
      const inspect = async (
        client: SimulatedE2EClient,
        label: string,
      ): Promise<Snapshot> => {
        await openNotes(client, 'Today');
        const state = await snapshot(client.page);
        states[label] = state;
        const visible = await client.page
          .locator('notes .notes > div[id^="n-"]')
          .evaluateAll((nodes) => nodes.map((node) => node.id.slice(2)));
        expect(visible).toEqual(state.note.todayOrder);
        expect(state.note.entities).toEqual(expectedEntities);
        expect(state.projectOrder).toEqual(before.projectOrder);
        const entries = await rows(client.page);
        expect(pending(entries)).toEqual([]);
        expect(replacements(entries).every((id) => fullStateIds.has(id))).toBe(true);
        // No replacement ops or duplicate retries are needed for this crossing.
        expect(
          entries
            .filter((r) => r.op.e === 'NOTE' && r.op.o !== 'CRT')
            .map((r) => r.op.id)
            .sort(),
        ).toEqual([order.id, update.id].sort());
        return state;
      };
      for (const client of [a, b]) {
        const live = await inspect(client, `${client.clientName}-live`);
        await client.page.reload();
        await waitForAppReady(client.page);
        await sync(client);
        expect(await inspect(client, `${client.clientName}-reloaded`)).toEqual(live);
      }
      const fresh = await makeClient('Fresh');
      await sync(fresh);
      const replayed = await inspect(fresh, 'fresh-history');
      expect(states['B-live']).toEqual(states['A-live']);
      expect(replayed).toEqual(states['A-live']);
      expect(replayed.note.todayOrder).toEqual([ids[0], ...reordered]);
      expect(new Set(replayed.note.todayOrder).size).toBe(4);
    } finally {
      await writeFile(
        testInfo.outputPath('evidence.json'),
        JSON.stringify(evidence, null, 2),
      );
      for (const client of clients) await closeClient(client);
    }
  });
}
