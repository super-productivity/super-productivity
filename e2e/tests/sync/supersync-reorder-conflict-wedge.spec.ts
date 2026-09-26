import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * KNOWN GAP (#10264) — pending (`test.fixme`) until the multi-entity reorder
 * class is fixed. See docs/plans/2026-09-26-sync-architecture-review.md ("Bugs found").
 *
 * Dragging a note in the notes panel dispatches `updateNoteOrder`
 * (`NotesComponent.drop` → `NoteService.updateOrder`), a multi-entity operation
 * whose `entityIds` list every note in the panel. When another device edits one
 * of those notes concurrently, conflict resolution has no resolution path for
 * the reorder and throws `UnsupportedMultiEntityConflictError`: sync stops, and
 * a manual sync opens the whole-dataset "keep local / keep remote" dialog.
 * Habit, board and section reorders share the shape; the mechanism for all four
 * is pinned by
 * src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts.
 *
 * The test dispatches the action `NotesComponent.drop` dispatches rather than
 * dragging. `syncAndWait()` resolves the conflict dialog with "remote" on its
 * own, which would hide exactly this failure, so the crossing sync is
 * triggered with `clickSyncBtn()`, its outcome observed directly, and the
 * console watched for the error code.
 */

const INBOX_PROJECT_ID = 'INBOX_PROJECT';

interface PersistentAction extends Record<string, unknown> {
  type: string;
  meta: Record<string, unknown>;
}

interface NotesSnapshot {
  inboxNoteIds: string[];
  contents: Record<string, string>;
}

type CrossingOutcome = 'conflict-dialog' | 'error' | 'in-sync' | 'pending';

const dispatchPersistentAction = async (
  page: Page,
  action: PersistentAction,
): Promise<void> => {
  const dispatched = await page.evaluate((actionToDispatch) => {
    type StoreLike = { dispatch: (value: unknown) => void };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) return false;
    store.dispatch(actionToDispatch);
    return true;
  }, action);
  expect(dispatched).toBe(true);
};

const getNotesSnapshot = async (page: Page, noteIds: string[]): Promise<NotesSnapshot> =>
  page.evaluate(
    ({ ids, inboxId }) => {
      type StoreState = {
        note?: { entities?: Record<string, { content: string } | undefined> };
        projects?: { entities?: Record<string, { noteIds?: string[] } | undefined> };
      };
      type StoreLike = {
        subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) throw new Error('__e2eTestHelpers.store missing');

      let state: StoreState | undefined;
      const subscription = store.subscribe((value) => {
        state = value;
      });
      subscription.unsubscribe();

      return {
        inboxNoteIds: (state?.projects?.entities?.[inboxId]?.noteIds ?? []).filter((id) =>
          ids.includes(id),
        ),
        contents: Object.fromEntries(
          ids.map((id) => [id, state?.note?.entities?.[id]?.content ?? '<missing>']),
        ),
      };
    },
    { ids: noteIds, inboxId: INBOX_PROJECT_ID },
  );

/** Reads the outcome of a manually triggered sync without resolving dialogs. */
const getCrossingOutcome = async (
  client: SimulatedE2EClient,
): Promise<CrossingOutcome> => {
  if (await client.sync.conflictDialog.isVisible().catch(() => false)) {
    return 'conflict-dialog';
  }
  if (await client.sync.hasSyncError()) {
    return 'error';
  }
  const spinning = await client.sync.syncSpinner.isVisible().catch(() => false);
  const checked = await client.sync.syncCheckIcon
    .filter({ hasText: /^done_all$/ })
    .isVisible()
    .catch(() => false);
  return !spinning && checked ? 'in-sync' : 'pending';
};

/** Every sync after the crossing must fail on a dialog, never choose a side. */
const syncWithoutResolvingConflicts = async (
  client: SimulatedE2EClient,
): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  await expect
    .poll(async () => getCrossingOutcome(client), { timeout: 30000 })
    .not.toBe('pending');
  expect(await getCrossingOutcome(client)).toBe('in-sync');
};

const addNoteAction = (id: string, content: string): PersistentAction => ({
  type: '[Note] Add Note',
  note: {
    id,
    projectId: INBOX_PROJECT_ID,
    isPinnedToToday: false,
    content,
    created: Date.now(),
    modified: Date.now(),
  },
  isPreventFocus: true,
  meta: { isPersistent: true, entityType: 'NOTE', entityId: id, opType: 'CRT' },
});

test.describe('@supersync reorder crossing a concurrent edit', () => {
  test.describe.configure({ mode: 'serial' });

  test.fixme('keeps syncing when a note reorder crosses a concurrent note edit', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    const noteA = `note-a-${testRunId}`;
    const noteB = `note-b-${testRunId}`;
    const editedOnB = 'edited on B while A reordered';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Both devices start from the same two notes in the Inbox project.
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await dispatchPersistentAction(clientA.page, addNoteAction(noteA, 'note A'));
      await dispatchPersistentAction(clientA.page, addNoteAction(noteB, 'note B'));
      // addNote prepends, so the panel shows B above A.
      await expect
        .poll(
          async () =>
            (await getNotesSnapshot(clientA!.page, [noteA, noteB])).inboxNoteIds,
        )
        .toEqual([noteB, noteA]);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expect
        .poll(
          async () =>
            (await getNotesSnapshot(clientB!.page, [noteA, noteB])).inboxNoteIds,
        )
        .toEqual([noteB, noteA]);

      // Device A drags note A above note B (exactly what NotesComponent.drop
      // dispatches). The operation stays pending: tests sync only on demand.
      const reordered = [noteA, noteB];
      await dispatchPersistentAction(clientA.page, {
        type: '[Note] Update Note Order',
        ids: reordered,
        activeContextType: 'PROJECT',
        activeContextId: INBOX_PROJECT_ID,
        meta: {
          isPersistent: true,
          entityType: 'NOTE',
          entityIds: reordered,
          opType: 'MOV',
          isBulk: true,
        },
      });
      await expect
        .poll(
          async () =>
            (await getNotesSnapshot(clientA!.page, [noteA, noteB])).inboxNoteIds,
        )
        .toEqual(reordered);

      // Meanwhile device B edits note A and syncs first.
      await dispatchPersistentAction(clientB.page, {
        type: '[Note] Update Note',
        note: { id: noteA, changes: { content: editedOnB } },
        meta: { isPersistent: true, entityType: 'NOTE', entityId: noteA, opType: 'UPD' },
      });
      await clientB.sync.syncAndWait();

      // Device A syncs. Today this stops with UnsupportedMultiEntityConflictError
      // and opens the whole-dataset conflict dialog instead of merging. Watch the
      // console as well: a later syncAndWait() would resolve that dialog with
      // "remote" on its own and hide the stop.
      const multiEntityErrors: string[] = [];
      clientA.page.on('console', (message) => {
        if (message.text().includes('SYNC_MULTI_ENTITY_UNSUPPORTED')) {
          multiEntityErrors.push(message.text());
        }
      });
      await syncWithoutResolvingConflicts(clientA);

      // Both devices converge and keep B's edit. Either device's order may
      // survive (decided 2026-09-26, plan section 7); keeping A's order is a
      // later improvement.
      await syncWithoutResolvingConflicts(clientB);
      await syncWithoutResolvingConflicts(clientA);
      const snapshotA = await getNotesSnapshot(clientA.page, [noteA, noteB]);
      const snapshotB = await getNotesSnapshot(clientB.page, [noteA, noteB]);
      expect(snapshotA).toEqual(snapshotB);
      expect(snapshotA.contents).toEqual({ [noteA]: editedOnB, [noteB]: 'note B' });
      expect([...snapshotA.inboxNoteIds].sort()).toEqual([noteA, noteB].sort());
      expect(multiEntityErrors).toEqual([]);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
