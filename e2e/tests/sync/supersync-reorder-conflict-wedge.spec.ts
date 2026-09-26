import type { Page } from '@playwright/test';
import type { CompactOperationLogEntry } from '../../../src/app/op-log/persistence/compact/compact-operation.types';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getLocalOpLogSummary,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { NotePage } from '../../pages/note.page';
import {
  RELEASED_APP_URL,
  serveReleasedClientAssets,
} from '../../utils/released-client-assets';

/**
 * #10264: real app reducers, capture, encrypted transport and conflict recovery.
 * Dispatch the same persistent actions as the UI. Never select a side in the
 * whole-dataset dialog: syncAndWait() would silently hide this regression.
 */
const PROJECT_ID = 'INBOX_PROJECT';
type Family = 'project notes' | 'Today notes' | 'habits' | 'boards' | 'sections';
interface PersistentAction extends Record<string, unknown> {
  type: string;
  meta: Record<string, unknown>;
}
interface Snapshot {
  order: string[];
  entities: Record<string, Record<string, unknown>>;
  otherOrder?: string[];
}

const action = (
  type: string,
  entityType: string,
  id: string | string[],
  opType: string,
  payload: Record<string, unknown>,
): PersistentAction => ({
  type,
  ...payload,
  meta: {
    isPersistent: true,
    entityType,
    ...(Array.isArray(id) ? { entityIds: id, isBulk: true } : { entityId: id }),
    opType,
  },
});

const dispatch = async (
  page: Page,
  value: PersistentAction | PersistentAction[],
): Promise<void> => {
  await page.evaluate(async (a) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (value: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    for (const item of Array.isArray(a) ? a : [a]) store.dispatch(item);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, value);
};

const readRows = (page: Page): Promise<CompactOperationLogEntry[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<CompactOperationLogEntry[]>((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });

const editContent = async (
  page: Page,
  family: Family,
  edit: PersistentAction,
): Promise<void> => {
  if (family !== 'boards') return dispatch(page, edit);
  // The editor saves the full board config, even for a rename.
  await page.goto('/#/boards');
  await page.getByRole('tab', { name: edit.id as string, exact: true }).click();
  await page.locator('board:visible button').filter({ hasText: 'edit' }).click();
  const dialog = page.locator('dialog-board-edit');
  await dialog.locator('input[type="text"]').fill('edited concurrently');
  await dialog.locator('input[type="number"]').fill('3');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(dialog).toBeHidden();
};

const snapshot = (
  page: Page,
  familyToRead: Family,
  idsToRead: string[],
): Promise<Snapshot> =>
  page.evaluate(
    ({ family, ids, projectId }) => {
      type Entity = Record<string, unknown>;
      type Slice = {
        ids: string[];
        entities: Record<string, Entity>;
        todayOrder: string[];
      };
      type State = {
        note: Slice;
        simpleCounter: Slice;
        section: Slice;
        projects: { entities: Record<string, { noteIds: string[] }> };
        boards: { boardCfgs: (Entity & { id: string })[] };
      };
      const store = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (next: (state: State) => void) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers.store;
      let state!: State;
      store
        .subscribe((value) => {
          state = value;
        })
        .unsubscribe();
      const entities =
        family === 'boards'
          ? Object.fromEntries(state.boards.boardCfgs.map((b) => [b.id, b]))
          : (family === 'habits'
              ? state.simpleCounter
              : family === 'sections'
                ? state.section
                : state.note
            ).entities;
      const order =
        family === 'project notes'
          ? state.projects.entities[projectId].noteIds
          : family === 'Today notes'
            ? state.note.todayOrder
            : family === 'boards'
              ? state.boards.boardCfgs.map((b) => b.id)
              : family === 'habits'
                ? state.simpleCounter.ids
                : state.section.ids;
      return {
        order: order.filter((id) => ids.includes(id)),
        entities: Object.fromEntries(ids.map((id) => [id, entities[id]])),
        ...(family.endsWith('notes')
          ? {
              otherOrder: (family === 'project notes'
                ? state.note.todayOrder
                : state.projects.entities[projectId].noteIds
              ).filter((id) => ids.includes(id)),
            }
          : {}),
      };
    },
    { family: familyToRead, ids: idsToRead, projectId: PROJECT_ID },
  );

/** Fail on the safety dialog/error; do not replace either device's dataset. */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  const outcome = async (): Promise<string> => {
    if (await client.sync.conflictDialog.isVisible()) return 'conflict-dialog';
    if (await client.sync.hasSyncError()) return 'error';
    const spinning = await client.sync.syncSpinner.isVisible();
    const checked = await client.sync.syncCheckIcon
      .filter({ hasText: /^done_all$/ })
      .isVisible();
    return !spinning && checked ? 'in-sync' : 'pending';
  };
  let observed = 'pending';
  await expect
    .poll(
      async () => {
        observed = await outcome();
        return observed;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(observed).toBe('in-sync');
};

const fixture = (
  family: Family,
  ids: string[],
): { seeds: PersistentAction[]; reorder: PersistentAction; edit: PersistentAction } => {
  const [a] = ids;
  if (family.endsWith('notes')) {
    return {
      seeds: ids.map((id) =>
        action('[Note] Add Note', 'NOTE', id, 'CRT', {
          note: {
            id,
            projectId: PROJECT_ID,
            isPinnedToToday: true,
            content: id,
            created: 100,
            modified: 100,
          },
          isPreventFocus: true,
        }),
      ),
      reorder: action('[Note] Update Note Order', 'NOTE', ids, 'MOV', {
        ids,
        activeContextType: family === 'project notes' ? 'PROJECT' : 'TAG',
        activeContextId: family === 'project notes' ? PROJECT_ID : 'TODAY',
      }),
      edit: action('[Note] Update Note', 'NOTE', a, 'UPD', {
        note: { id: a, changes: { content: 'edited concurrently' } },
      }),
    };
  }
  if (family === 'habits') {
    return {
      seeds: ids.map((id) =>
        action('[SimpleCounter] Add SimpleCounter', 'SIMPLE_COUNTER', id, 'CRT', {
          simpleCounter: {
            id,
            title: id,
            isEnabled: true,
            icon: null,
            type: 'ClickCounter',
            countOnDay: {},
            isOn: false,
          },
        }),
      ),
      reorder: action(
        '[SimpleCounter] Update SimpleCounter Order',
        'SIMPLE_COUNTER',
        ids,
        'MOV',
        { ids },
      ),
      edit: action(
        '[SimpleCounter] Set SimpleCounter Counter Today',
        'SIMPLE_COUNTER',
        a,
        'UPD',
        {
          id: a,
          newVal: 3,
          today: '2026-09-25',
        },
      ),
    };
  }
  if (family === 'boards') {
    return {
      seeds: ids.map((id) =>
        action('[Boards] Add Board', 'BOARD', id, 'CRT', {
          board: { id, title: id, cols: 2, panels: [] },
        }),
      ),
      reorder: action('[Boards] Sort Boards', 'BOARD', ids, 'MOV', { ids }),
      edit: action('[Boards] Update Board', 'BOARD', a, 'UPD', {
        id: a,
        updates: { id: a, title: 'edited concurrently', cols: 3, panels: [] },
      }),
    };
  }
  return {
    seeds: ids.map((id) =>
      action('[Section] Add Section', 'SECTION', id, 'CRT', {
        section: {
          id,
          contextId: PROJECT_ID,
          contextType: 'PROJECT',
          title: id,
          taskIds: [],
        },
      }),
    ),
    reorder: action('[Section] Update Section Order', 'SECTION', ids, 'MOV', {
      contextId: PROJECT_ID,
      ids,
    }),
    edit: action('[Section] Update Section', 'SECTION', a, 'UPD', {
      section: { id: a, changes: { title: 'edited concurrently' } },
    }),
  };
};

test.describe('@supersync reorder crossing content (#10264)', () => {
  test('habits: recovery leaves a concurrent disabled habit edit independent', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const ids = ['a', 'b', 'untouched'].map((id) => id + '-' + testRunId);
    const disabledId = 'disabled-' + testRunId;
    const data = fixture('habits', ids);
    const disabled = fixture('habits', [disabledId]).seeds[0];
    (disabled.simpleCounter as Record<string, unknown>).isEnabled = false;
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(a);
      await a.sync.setupSuperSync(config);
      await a.workView.addTask('Habit footprint-' + testRunId);
      for (const seed of [...data.seeds].reverse()) await dispatch(a.page, seed);
      await dispatch(a.page, disabled);
      await sync(a);
      for (const name of ['B', 'C']) {
        const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
        clients.push(client);
        await client.sync.setupSuperSync(config);
        await sync(client);
      }
      const [, b, c] = clients;
      const before = await snapshot(a.page, 'habits', ids);
      data.reorder.ids = [...before.order].reverse();
      data.reorder.meta.entityIds = data.reorder.ids;
      await dispatch(a.page, data.reorder);
      await dispatch(b.page, data.edit);
      // This real UI action targets a habit outside the original enabled-only drag.
      await c.page.goto('/#/habits');
      await c.page.locator('.disabled-section-header').click();
      await c.page
        .locator('.disabled-item')
        .filter({ hasText: disabledId })
        .locator('button')
        .filter({ hasText: 'visibility' })
        .click();
      expect(
        (await snapshot(c.page, 'habits', [disabledId])).entities[disabledId].isEnabled,
      ).toBe(true);
      await sync(b);
      await sync(a);
      await sync(a);
      // A recovery must not add the disabled id to its conflict footprint.
      await sync(c);
      await sync(a);
      await sync(b);
      const allIds = [...ids, disabledId];
      const final = await snapshot(a.page, 'habits', allIds);
      expect(await snapshot(b.page, 'habits', allIds)).toEqual(final);
      expect(await snapshot(c.page, 'habits', allIds)).toEqual(final);
      expect(final.entities[disabledId].isEnabled).toBe(true);
      expect(final.entities[ids[0]].countOnDay).toEqual(
        Object.fromEntries([['2026-09-25', 3]]),
      );
      expect([...final.order].sort()).toEqual([...allIds].sort());
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  // Each case has its own account; keep running the other baseline repros on failure.
  for (const family of [
    'project notes',
    'Today notes',
    'habits',
    'boards',
    'sections',
  ] as const) {
    for (const remoteReorder of [false, true]) {
      test(
        family +
          ': ' +
          (remoteReorder ? 'remote' : 'local') +
          ' reorder preserves content and order',
        async ({ browser, baseURL, testRunId }) => {
          test.setTimeout(180000);
          const appUrl = baseURL || 'http://localhost:4242';
          const ids = ['a', 'b', 'untouched'].map((id) => id + '-' + testRunId);
          const data = fixture(family, ids);
          const clients: SimulatedE2EClient[] = [];
          try {
            const config = getSuperSyncConfig(await createTestUser(testRunId));
            const a = await createSimulatedClient(browser, appUrl, 'A', testRunId);
            clients.push(a);
            await a.sync.setupSuperSync(config);
            for (const seed of [...data.seeds].reverse()) await dispatch(a.page, seed);
            await sync(a);
            const b = await createSimulatedClient(browser, appUrl, 'B', testRunId);
            clients.push(b);
            await b.sync.setupSuperSync(config);
            await sync(b);
            const before = await snapshot(a.page, family, ids);
            expect(await snapshot(b.page, family, ids)).toEqual(before);

            const importsBefore = await Promise.all(
              [a, b].map(
                async (client) =>
                  (await getLocalOpLogSummary(client.page)).filter((op) =>
                    ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(op.opType),
                  ).length,
              ),
            );
            // Always reverse the actual seeded order (adapter add differs by family).
            const reordered = [...before.order].reverse();
            data.reorder.ids = reordered;
            data.reorder.meta.entityIds = reordered;
            const reorderClient = remoteReorder ? b : a;
            const contentClient = remoteReorder ? a : b;
            if (remoteReorder) await editContent(contentClient.page, family, data.edit);
            await dispatch(reorderClient.page, data.reorder);
            expect((await snapshot(reorderClient.page, family, ids)).order).toEqual(
              reordered,
            );
            if (!remoteReorder) await editContent(contentClient.page, family, data.edit);
            const edited = await snapshot(contentClient.page, family, ids);
            expect(edited.entities).not.toEqual(before.entities);
            expect(edited.entities[ids[1]]).toEqual(before.entities[ids[1]]);
            expect(edited.entities[ids[2]]).toEqual(before.entities[ids[2]]);

            // The uploaded action is newer in both directions. Integration tests
            // cover the other timestamp winner. A always resolves pending work.
            await sync(b);
            await sync(a);
            await sync(b);
            await sync(a);
            expect(
              await Promise.all(
                [a, b].map(
                  async (client) =>
                    (await getLocalOpLogSummary(client.page)).filter((op) =>
                      ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(op.opType),
                    ).length,
                ),
              ),
            ).toEqual(importsBefore);
            const converged = await snapshot(a.page, family, ids);
            expect(await snapshot(b.page, family, ids)).toEqual(converged);
            expect(converged.entities).toEqual(edited.entities);
            expect([...converged.order].sort()).toEqual([...ids].sort());
            expect(converged.otherOrder).toEqual(before.otherOrder);

            // Exercise persisted replay and sequence-zero replay for both note
            // scopes/directions, without resetting either established client.
            if (family.endsWith('notes')) {
              for (const client of [a, b]) {
                await client.page.reload();
                await waitForAppReady(client.page);
                expect(await snapshot(client.page, family, ids)).toEqual(converged);
                await sync(client);
              }
              const fresh = await createSimulatedClient(
                browser,
                appUrl,
                'Fresh',
                testRunId,
              );
              clients.push(fresh);
              await fresh.sync.setupSuperSync(config);
              await sync(fresh);
              expect(await snapshot(fresh.page, family, ids)).toEqual(converged);
            }
          } finally {
            for (const client of clients) await closeClient(client);
          }
        },
      );
    }

    for (const pendingContent of family === 'habits' ? [false, true] : [false]) {
      test(
        family +
          (pendingContent
            ? ': reissues the content after interrupted sync and compaction'
            : ': keeps the reorder pending after interrupted sync and compaction'),
        async ({ browser, baseURL, testRunId }) => {
          test.setTimeout(240000);
          const ids = ['a', 'b', 'untouched'].map((id) => id + '-' + testRunId);
          const data = fixture(family, ids);
          if (pendingContent) {
            // The receiver's default-field repair must not mask loss of this type.
            (data.seeds[0].simpleCounter as Record<string, unknown>).type = 'StopWatch';
          }
          const clients: SimulatedE2EClient[] = [];
          try {
            const config = getSuperSyncConfig(await createTestUser(testRunId));
            const a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
            clients.push(a);
            await a.sync.setupSuperSync(config);
            // Ordinary task activity later triggers real log compaction while offline.
            await a.workView.addTask('Compaction activity-' + testRunId);
            for (const seed of [...data.seeds].reverse()) await dispatch(a.page, seed);
            await sync(a);
            const activityTaskId = (await readRows(a.page)).find(
              (row) => row.op.e === 'TASK' && row.op.o === 'CRT',
            )!.op.d!;
            const b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
            clients.push(b);
            await b.sync.setupSuperSync(config);
            await sync(b);
            const before = await snapshot(a.page, family, ids);
            const reversed = [...before.order].reverse();
            data.reorder.ids = reversed;
            data.reorder.meta.entityIds = reversed;
            let offline = false;
            let allowUpload = false;
            await a.page.route('**/api/sync/**', async (route) => {
              if (offline || (!allowUpload && route.request().method() === 'POST'))
                await route.abort();
              else await route.continue();
            });
            if (pendingContent) {
              await editContent(a.page, family, data.edit);
              await dispatch(b.page, data.reorder);
            } else {
              await dispatch(a.page, data.reorder);
              await editContent(b.page, family, data.edit);
            }
            const edited = await snapshot(pendingContent ? a.page : b.page, family, ids);
            await sync(b);
            const blockedUpload = a.page.waitForRequest(
              (request) =>
                request.url().includes('/api/sync/ops') && request.method() === 'POST',
            );
            await a.sync.clickSyncBtn();
            await blockedUpload;
            await expect(a.sync.syncSpinner).toBeHidden();
            const interrupted = await snapshot(a.page, family, ids);
            expect(interrupted.order).toEqual(reversed);
            expect(interrupted.entities).toEqual(edited.entities);
            const rows = await readRows(a.page);
            const original = rows.find(
              (row) =>
                row.source === 'local' &&
                row.op.e === data.reorder.meta.entityType &&
                row.op.o === (pendingContent ? 'UPD' : 'MOV'),
            )!;
            const remote = rows.find(
              (row) =>
                row.source === 'remote' &&
                row.op.e === data.edit.meta.entityType &&
                row.op.o === (pendingContent ? 'MOV' : 'UPD'),
            )!;
            expect(original.rejectedAt).toBeUndefined();
            expect(original.syncedAt).toBeUndefined();
            expect(remote.applicationStatus).toBe('applied');
            offline = true;
            // Age only application metadata; payloads, clocks and state remain real.
            // The production compactor, not this fixture, removes the retained row.
            await a.page.evaluate(async (seq) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const r = indexedDB.open('SUP_OPS');
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
              try {
                await new Promise<void>((resolve, reject) => {
                  const retentionAge = 8 * 24 * 60 * 60 * 1000;
                  const tx = db.transaction('ops', 'readwrite');
                  const r = tx.objectStore('ops').get(seq);
                  r.onsuccess = () =>
                    tx.objectStore('ops').put({
                      ...r.result,
                      appliedAt: Date.now() - retentionAge,
                    });
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => reject(tx.error);
                });
              } finally {
                db.close();
              }
            }, remote.seq);
            await dispatch(
              a.page,
              Array.from({ length: 500 }, (_, i) =>
                action('[Task Shared] updateTask', 'TASK', activityTaskId, 'UPD', {
                  task: {
                    id: activityTaskId,
                    changes: { title: 'Offline activity ' + i },
                  },
                }),
              ),
            );
            await expect
              .poll(
                async () =>
                  (await readRows(a.page)).some((row) => row.op.id === remote.op.id),
                { timeout: 60000 },
              )
              .toBe(false);
            // A real compaction checkpoint must retain the optimistic state on restart.
            await a.page.reload();
            await waitForAppReady(a.page);
            expect(await snapshot(a.page, family, ids)).toEqual(interrupted);
            offline = false;
            allowUpload = true;
            const expectOriginalRejected = async (): Promise<void> => {
              const rejected = a.page.waitForResponse(
                (response) =>
                  response.url().includes('/api/sync/ops') &&
                  response.request().method() === 'POST',
              );
              await a.sync.clickSyncBtn();
              const response = await rejected;
              expect(response.ok()).toBe(true);
              const body = await response.json();
              expect(body.results).toContainEqual(
                expect.objectContaining({
                  opId: original.op.id,
                  accepted: false,
                  errorCode: 'CONFLICT_CONCURRENT',
                }),
              );
              await expect(a.sync.syncSpinner).toBeHidden();
            };
            if (pendingContent) {
              // An absolute counter-today set is reissued with its current value:
              // sync must neither stop nor fall back to type-stripping entity LWW.
              await expectOriginalRejected();
              await expect(a.sync.conflictDialog).toBeHidden();
              expect(await a.sync.hasSyncError()).toBe(false);
              await sync(a);
              await sync(b);
              const converged = await snapshot(a.page, family, ids);
              expect(converged).toEqual(interrupted);
              expect(await snapshot(b.page, family, ids)).toEqual(converged);
              expect(converged.entities[ids[0]].type).toBe('StopWatch');
              const replaced = (await readRows(a.page)).find(
                (row) => row.op.id === original.op.id,
              )!;
              expect(replaced.rejectedAt).toBeDefined();
              await a.page.reload();
              await waitForAppReady(a.page);
              expect(await snapshot(a.page, family, ids)).toEqual(converged);
              return;
            }
            for (let attempt = 0; attempt < 4; attempt++) {
              await expectOriginalRejected();
              await expect(a.sync.conflictDialog).toBeVisible();
              await a.sync.conflictDialog
                .getByRole('button', { name: 'Cancel', exact: true })
                .click();
              const retained = (await readRows(a.page)).find(
                (row) => row.op.id === original.op.id,
              )!;
              expect(retained.rejectedAt).toBeUndefined();
              expect(retained.syncedAt).toBeUndefined();
              expect(await snapshot(a.page, family, ids)).toEqual(interrupted);
            }
            await sync(b);
            const peer = await snapshot(b.page, family, ids);
            expect(peer.entities).toEqual(interrupted.entities);
            expect(peer.order).toEqual(before.order);
            await a.page.reload();
            await waitForAppReady(a.page);
            expect(await snapshot(a.page, family, ids)).toEqual(interrupted);
            const retained = (await readRows(a.page)).find(
              (row) => row.op.id === original.op.id,
            )!;
            expect(retained.rejectedAt).toBeUndefined();
            expect(retained.syncedAt).toBeUndefined();
          } finally {
            for (const client of clients) await closeClient(client);
          }
        },
      );
    }
  }
});

// Supply the untouched assets/public directory extracted from the published APK.
// Production bundles expose no test store; the released producer uses the UI.
test.describe('@supersync released reorder compatibility (#10264)', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! });
  });
  test.afterAll(async () => assets?.close());

  for (const oldReorders of [false, true]) {
    test(
      'old uploads first, new resolves ' +
        (oldReorders ? 'content' : 'reorder') +
        ', old consumes',
      async ({ browser, baseURL, testRunId }) => {
        test.setTimeout(180000);
        const ids = ['a', 'b', 'untouched'].map((id) => id + '-' + testRunId);
        const data = fixture('project notes', ids);
        const clients: SimulatedE2EClient[] = [];
        try {
          const config = getSuperSyncConfig(await createTestUser(testRunId));
          const current = await createSimulatedClient(
            browser,
            baseURL!,
            'Current',
            testRunId,
          );
          clients.push(current);
          await current.sync.setupSuperSync(config);
          for (const seed of [...data.seeds].reverse())
            await dispatch(current.page, seed);
          await sync(current);
          const released = await createSimulatedClient(
            browser,
            RELEASED_APP_URL,
            'Released',
            testRunId,
            { serviceWorkers: 'block' },
          );
          clients.push(released);
          await released.sync.setupSuperSync(config);
          await sync(released);
          const versions: (string | null)[] = [];
          released.page.on('request', (request) => {
            if (request.method() === 'GET' && request.url().includes('/api/sync/ops?')) {
              versions.push(new URL(request.url()).searchParams.get('appVersion'));
            }
          });
          await released.page.goto(
            RELEASED_APP_URL + '/#/project/' + PROJECT_ID + '/tasks',
          );
          const notes = new NotePage(released.page);
          await notes.ensureNotesVisible();
          const uiOrder = (): Promise<string[]> =>
            released.page
              .locator('notes [cdkdrag]')
              .evaluateAll((elements) => elements.map((element) => element.id.slice(2)));
          await expect.poll(uiOrder).toEqual(ids);
          const reversed = [...ids].reverse();
          data.reorder.ids = reversed;
          data.reorder.meta.entityIds = reversed;
          if (oldReorders) {
            await dispatch(current.page, data.edit);
            // Real CDK drag from the released UI, no injected action or modified bundle.
            const source = released.page.locator('#n-' + ids[2] + ' .handle-drag');
            const target = released.page.locator('#n-' + ids[0]);
            await source.hover();
            await expect(source).toHaveCSS('opacity', '1');
            const from = await source.boundingBox();
            const to = await target.boundingBox();
            if (!from || !to) throw new Error('Released note drag targets missing');
            const halfSourceWidth = from.width / 2;
            const halfSourceHeight = from.height / 2;
            const halfTargetWidth = to.width / 2;
            await released.page.mouse.move(
              from.x + halfSourceWidth,
              from.y + halfSourceHeight,
            );
            await released.page.mouse.down();
            await released.page.mouse.move(
              from.x + halfSourceWidth,
              from.y + halfSourceHeight - 10,
              { steps: 3 },
            );
            await expect(released.page.locator('.cdk-drag-preview')).toBeVisible();
            await released.page.mouse.move(to.x + halfTargetWidth, to.y + 10, {
              steps: 25,
            });
            await released.page.mouse.up();
            await expect(released.page.locator('.cdk-drag-preview')).toBeHidden();
            await expect.poll(uiOrder).not.toEqual(ids);
          } else {
            await dispatch(current.page, data.reorder);
            await notes.editNote(notes.getNoteByContent(ids[0]), 'edited concurrently');
          }
          // This sequencing is the compatibility contract: the old client never
          // owns the first resolution of the crossing.
          const oldWriteType = oldReorders ? 'MOV' : 'UPD';
          await expect
            .poll(async () =>
              (await getLocalOpLogSummary(released.page)).some(
                (op) =>
                  op.entityType === 'NOTE' && op.opType === oldWriteType && !op.isSynced,
              ),
            )
            .toBe(true);
          await sync(released);
          await expect
            .poll(async () =>
              (await getLocalOpLogSummary(released.page))
                .filter((op) => op.entityType === 'NOTE' && op.opType === oldWriteType)
                .every((op) => op.isSynced),
            )
            .toBe(true);
          await sync(current);
          await sync(released);
          await sync(current);
          const finalState = await snapshot(current.page, 'project notes', ids);
          expect(finalState.entities[ids[0]].content).toBe('edited concurrently');
          expect(finalState.entities[ids[1]].content).toBe(ids[1]);
          expect(finalState.entities[ids[2]].content).toBe(ids[2]);
          expect([...finalState.order].sort()).toEqual([...ids].sort());
          await expect.poll(uiOrder).toEqual(finalState.order);
          await expect(notes.getNoteByContent('edited concurrently')).toBeVisible();
          await expect(notes.getNoteByContent(ids[1])).toBeVisible();
          await expect(notes.getNoteByContent(ids[2])).toBeVisible();
          expect(versions).toContain('19.1.0');

          // Verify the accepted replacement, not merely the rejected original
          // upload attempt. These are the two distinct released-reader histories.
          const histories = await current.page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const r = indexedDB.open('SUP_OPS');
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            try {
              const rows = await new Promise<
                {
                  source: string;
                  syncedAt?: number;
                  rejectedAt?: number;
                  op: {
                    a?: string;
                    actionType?: string;
                    e?: string;
                    entityType?: string;
                  };
                }[]
              >((resolve, reject) => {
                const r = db.transaction('ops').objectStore('ops').getAll();
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
              return rows
                .filter(
                  (r) =>
                    r.source === 'local' &&
                    r.syncedAt &&
                    !r.rejectedAt &&
                    (r.op.e ?? r.op.entityType) === 'NOTE',
                )
                .map((r) => r.op.a ?? r.op.actionType);
            } finally {
              db.close();
            }
          });
          expect(histories).toContain(oldReorders ? 'NU' : 'NO');
          await released.page.reload();
          await waitForAppReady(released.page);
          await notes.ensureNotesVisible();
          await expect.poll(uiOrder).toEqual(finalState.order);
          await expect(notes.getNoteByContent('edited concurrently')).toBeVisible();
        } finally {
          for (const client of clients) await closeClient(client);
        }
      },
    );
  }
});
