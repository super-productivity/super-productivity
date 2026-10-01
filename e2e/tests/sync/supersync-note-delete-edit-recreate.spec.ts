import type { Page } from '@playwright/test';
import type { NoteState } from '../../../src/app/features/note/note.model';
import { expect, test } from '../../fixtures/supersync.fixture';
import { NotePage } from '../../pages/note.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

/**
 * #10380 (note half): one device deletes notes while another edits them.
 * When the edit wins, the deleting device must restore each note intact, back
 * in its project's note list and, if pinned, in Today; when the delete wins,
 * the notes are gone everywhere. Seeded through the store, both concurrent
 * changes use the real UI.
 */
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

const pendingCount = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const all = await new Promise<
        { source: string; syncedAt?: number; rejectedAt?: number }[]
      >((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return all.filter((e) => e.source === 'local' && !e.syncedAt && !e.rejectedAt)
        .length;
    } finally {
      db.close();
    }
  });

// A real successful download, then neither an error nor a dataset choice.
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
const openProjectNotes = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.goto(`/#/project/${PROJECT}/tasks`);
  await client.workView.waitForTaskList();
  await new NotePage(client.page).ensureNotesVisible();
  await expect(client.page.locator('notes .notes')).toBeVisible();
};
const noteMenuAction = async (
  client: SimulatedE2EClient,
  id: string,
  icon: 'delete_forever' | 'lock_open',
): Promise<void> => {
  const note = client.page.locator(`#n-${id}`);
  await note.hover();
  await note.locator('button:has(mat-icon:text-is("more_vert"))').click();
  await client.page
    .locator('.mat-mdc-menu-panel button')
    .filter({ has: client.page.locator(`mat-icon:text-is("${icon}")`) })
    .click();
  await expect(client.page.locator('.mat-mdc-menu-panel')).toBeHidden();
};

// Drop the display-only `modified`: the recreate stamps local apply time.
const comparable = (state: Snapshot): unknown => ({
  entities: Object.fromEntries(
    Object.entries(state.note.entities).map(([id, n]) => {
      const rest: Record<string, unknown> = { ...n };
      delete rest['modified'];
      return [id, rest];
    }),
  ),
  ids: [...(state.note.ids as string[])].sort(),
  todayOrder: [...state.note.todayOrder].sort(),
  projectOrder: [...state.projectOrder].sort(),
});

const noteIds = (testRunId: string): string[] =>
  // [plain target, Today-pinned target, untouched pinned witness]
  ['plain', 'pinned', 'witness'].map((id) => `${id}-${testRunId}`);

const seedNotes = async (page: Page, ids: string[]): Promise<void> => {
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );
  await page.evaluate(
    async ({ ids: seedIds, projectId }) => {
      const store = (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers.store;
      for (const [index, id] of [...seedIds.entries()].reverse()) {
        store.dispatch({
          type: '[Note] Add Note',
          note: {
            id,
            projectId,
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
};

/** Both targets locked and kept everywhere, or both gone everywhere. */
const expectedState = (before: Snapshot, ids: string[], editWins: boolean): unknown => {
  const targets = ids.slice(0, 2);
  const entities = editWins
    ? Object.fromEntries(
        ids.map((id) => [
          id,
          {
            ...before.note.entities[id],
            isLock: targets.includes(id) ? true : before.note.entities[id]?.isLock,
          },
        ]),
      )
    : { [ids[2]]: before.note.entities[ids[2]] };
  return comparable({
    note: {
      ...before.note,
      ids: Object.keys(entities),
      entities: entities as NoteState['entities'],
      todayOrder: editWins ? ids.slice(1) : [ids[2]],
    },
    projectOrder: editWins ? ids : [ids[2]],
  });
};

/** A current client's store, lists without duplicates, and its rendered notes. */
const inspectCurrent = async (
  client: SimulatedE2EClient,
  ids: string[],
  expected: unknown,
  editWins: boolean,
): Promise<Snapshot> => {
  const state = await snapshot(client.page);
  expect(comparable(state)).toEqual(expected);
  // No duplicates hidden by the sorted comparison.
  expect(new Set(state.projectOrder).size).toBe(state.projectOrder.length);
  expect(new Set(state.note.todayOrder).size).toBe(state.note.todayOrder.length);
  expect(await pendingCount(client.page)).toBe(0);
  await openProjectNotes(client);
  for (const id of ids.slice(0, 2)) {
    await expect(client.page.locator(`#n-${id}`)).toHaveCount(editWins ? 1 : 0);
  }
  return state;
};

const blockAutoSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.addInitScript(() => {
    const flags = window as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });
};

const scenarios = [
  { editWins: true, deleterSyncsFirst: false },
  { editWins: true, deleterSyncsFirst: true },
  { editWins: false, deleterSyncsFirst: false },
  { editWins: false, deleterSyncsFirst: true },
];

for (const { editWins, deleterSyncsFirst } of scenarios) {
  test(`@supersync note delete vs edit / ${editWins ? 'edit' : 'delete'} newer / ${deleterSyncsFirst ? 'deleter' : 'editor'} syncs first`, async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const makeClient = async (name: string): Promise<SimulatedE2EClient> => {
        const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
        clients.push(client);
        await client.sync.setupSuperSync(config);
        await blockAutoSync(client);
        return client;
      };
      const deleter = await makeClient('Deleter');
      const ids = noteIds(testRunId);
      const targets = ids.slice(0, 2);
      await seedNotes(deleter.page, ids);
      await sync(deleter);
      const editor = await makeClient('Editor');
      await sync(editor);
      const before = await snapshot(editor.page);
      expect(comparable(await snapshot(deleter.page))).toEqual(comparable(before));
      expect(before.projectOrder).toEqual(ids);
      expect(before.note.todayOrder).toEqual(ids.slice(1));

      const remove = async (): Promise<void> => {
        await openProjectNotes(deleter);
        for (const id of targets) await noteMenuAction(deleter, id, 'delete_forever');
        await expect.poll(() => pendingCount(deleter.page)).toBe(2);
      };
      const lock = async (): Promise<void> => {
        await openProjectNotes(editor);
        for (const id of targets) await noteMenuAction(editor, id, 'lock_open');
        await expect.poll(() => pendingCount(editor.page)).toBe(2);
      };
      // The later real UI action wins by LWW timestamp.
      if (editWins) {
        await remove();
        await lock();
      } else {
        await lock();
        await remove();
      }

      const [first, second] = deleterSyncsFirst ? [deleter, editor] : [editor, deleter];
      await sync(first);
      await sync(second);
      await sync(first);
      await sync(second);

      const expected = expectedState(before, ids, editWins);
      for (const client of [deleter, editor]) {
        const live = await inspectCurrent(client, ids, expected, editWins);
        await client.page.reload();
        await waitForAppReady(client.page);
        await sync(client);
        expect(comparable(await inspectCurrent(client, ids, expected, editWins))).toEqual(
          comparable(live),
        );
      }
      const fresh = await makeClient('Fresh');
      await sync(fresh);
      await inspectCurrent(fresh, ids, expected, editWins);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
}

// A v19.1.0 device edits while a current device deletes, so the released
// client receives a `deleteNote` that carries the note. A v19.1.0 DELETING
// device is not covered: the deleting device builds the recreate from its own
// delete op, so its outcome is v19.1.0's by construction (#10393).
test.describe('@supersync released editor vs current note delete', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  for (const editWins of [true, false]) {
    test(`a released editor and a current deleter converge / ${editWins ? 'edit' : 'delete'} newer`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const makeCurrent = async (name: string): Promise<SimulatedE2EClient> => {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.sync.setupSuperSync(config);
          await blockAutoSync(client);
          return client;
        };
        const deleter = await makeCurrent('Deleter');
        const ids = noteIds(testRunId);
        const targets = ids.slice(0, 2);
        await seedNotes(deleter.page, ids);
        await sync(deleter);
        const before = await snapshot(deleter.page);

        // Released bundles expose no test store: drive and read it in the UI.
        const released = await createSimulatedClient(
          browser,
          assets.url,
          'Released',
          testRunId,
          { serviceWorkers: 'block' },
        );
        clients.push(released);
        await released.sync.setupSuperSync(config);
        await sync(released);
        await openProjectNotes(released);
        for (const id of ids)
          await expect(released.page.locator(`#n-${id}`)).toHaveCount(1);

        const remove = async (): Promise<void> => {
          await openProjectNotes(deleter);
          for (const id of targets) await noteMenuAction(deleter, id, 'delete_forever');
          await expect.poll(() => pendingCount(deleter.page)).toBe(2);
        };
        const lock = async (): Promise<void> => {
          await openProjectNotes(released);
          for (const id of targets) await noteMenuAction(released, id, 'lock_open');
          await sync(released);
        };
        // The released edit reaches the server before the current device syncs.
        if (editWins) {
          await remove();
          await lock();
        } else {
          await lock();
          await remove();
        }
        await sync(deleter);
        await sync(released);
        await sync(deleter);

        await inspectCurrent(
          deleter,
          ids,
          expectedState(before, ids, editWins),
          editWins,
        );
        await openProjectNotes(released);
        for (const id of targets) {
          await expect(released.page.locator(`#n-${id}`)).toHaveCount(editWins ? 1 : 0);
        }
        await released.page.goto('/#/tag/TODAY/tasks');
        await released.workView.waitForTaskList();
        await new NotePage(released.page).ensureNotesVisible();
        await expect(released.page.locator(`#n-${ids[1]}`)).toHaveCount(editWins ? 1 : 0);
        await expect(released.page.locator(`#n-${ids[2]}`)).toHaveCount(1);

        const fresh = await makeCurrent('Fresh');
        await sync(fresh);
        await inspectCurrent(fresh, ids, expectedState(before, ids, editWins), editWins);
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
