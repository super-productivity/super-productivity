import { expect, type Page } from '@playwright/test';
import type { CompactOperationLogEntry } from '../../src/app/op-log/persistence/compact/compact-operation.types';
import { NotePage } from '../pages/note.page';
import { waitForAppReady } from './waits';

/**
 * Real-UI reorders and deletes of notes and habits, seeds and state readers for
 * the reorder crossing specs (#10377) of each sync provider.
 */
export type Row = CompactOperationLogEntry;
type Entity = Record<string, unknown>;
interface Slice {
  ids: string[];
  entities: Record<string, Entity>;
}
export type ListName = 'project notes' | 'Today notes' | 'habits';
export type OtherName = 'order' | 'Today order' | 'delete';
export interface Snapshot {
  /** The ordered list the reorder writes, restricted to the fixture's ids. */
  order: string[];
  /** Notes: the other note list; habits: empty. */
  second: string[];
  /** The fixture entities that exist. */
  entities: Record<string, Entity>;
  tasks: string[];
}

export const PROJECT = 'INBOX_PROJECT';

export const dispatch = async (
  page: Page,
  actions: Record<string, unknown>[],
): Promise<void> => {
  await page.evaluate(async (items) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    for (const item of items) store.dispatch(item);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, actions);
};

const persistent = (
  type: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => ({
  type,
  ...payload,
  meta: { isPersistent: true, entityType, entityId, opType: 'CRT' },
});

export const snapshot = async (
  page: Page,
  list: ListName,
  ids: string[],
): Promise<Snapshot> =>
  page.evaluate(
    ({ list: l, ids: fixture, projectId }) => {
      type State = {
        note: Slice & { todayOrder: string[] };
        projects: { entities: Record<string, { noteIds: string[] }> };
        simpleCounter: Slice;
        tasks: { entities: Record<string, { title: string }> };
      };
      let state!: State;
      (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (fn: (s: State) => void) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers.store
        .subscribe((s) => (state = s))
        .unsubscribe();
      const slice = l === 'habits' ? state.simpleCounter : state.note;
      const project = state.projects.entities[projectId].noteIds;
      const [first, second] =
        l === 'habits'
          ? [state.simpleCounter.ids, []]
          : l === 'project notes'
            ? [project, state.note.todayOrder]
            : [state.note.todayOrder, project];
      // Every listed id, so a dangling id of a deleted entity shows up too.
      const listed = (all: string[]): string[] =>
        all.filter((id) => fixture.includes(id));
      return {
        order: listed(first),
        second: listed(second),
        entities: Object.fromEntries(
          fixture
            .filter((id) => slice.entities[id])
            .map((id) => [id, slice.entities[id]]),
        ),
        tasks: Object.values(state.tasks.entities)
          .map((t) => t.title)
          .sort(),
      };
    },
    { list, ids, projectId: PROJECT },
  );

/**
 * A snapshot without `modified`, which an LWW Update sets to each device's own
 * apply time (lww-update.meta-reducer).
 */
export const withoutModified = (s: Snapshot): Snapshot => ({
  ...s,
  entities: Object.fromEntries(
    Object.entries(s.entities).map(([id, { modified: _m, ...rest }]) => [id, rest]),
  ),
});

export const rows = (page: Page): Promise<Row[]> =>
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
export const pending = (entries: Row[]): Row[] =>
  entries.filter((r) => r.source === 'local' && !r.syncedAt && !r.rejectedAt);
export const fullStateOps = (entries: Row[]): string[] =>
  entries
    .filter((r) => ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(r.op.o))
    .map((r) => r.op.id)
    .sort();

// ---------------------------------------------------------------------------
// Real UI actions
// ---------------------------------------------------------------------------

/** One CDK drag of `source` onto the top or bottom edge of `target`. */
const drag = async (
  page: Page,
  source: ReturnType<Page['locator']>,
  target: ReturnType<Page['locator']>,
  toBottom: boolean,
): Promise<void> => {
  await source.hover();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Drag targets missing');
  const halfFromWidth = from.width / 2;
  const halfFromHeight = from.height / 2;
  const halfToWidth = to.width / 2;
  const x = from.x + halfFromWidth;
  const y = from.y + halfFromHeight;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + (toBottom ? 8 : -8), { steps: 3 });
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  await page.mouse.move(to.x + halfToWidth, toBottom ? to.y + to.height - 4 : to.y + 4, {
    steps: 25,
  });
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toBeHidden();
};

export const openNotes = async (
  page: Page,
  list: ListName = 'project notes',
): Promise<void> => {
  await page.goto(
    list === 'Today notes' ? '/#/tag/TODAY/tasks' : `/#/project/${PROJECT}/tasks`,
  );
  await waitForAppReady(page, { ensureRoute: false });
  await new NotePage(page).ensureNotesVisible();
  await expect(page.locator('notes .notes')).toBeVisible();
};
const visibleNotes = (page: Page): Promise<string[]> =>
  page
    .locator('notes .notes > div[id^="n-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id.slice(2)));

const openHabits = async (page: Page): Promise<void> => {
  await page.goto('/#/habits');
  await waitForAppReady(page, { routeRegex: /#\/habits/, selector: '.habit-grid' });
  await expect(page.locator('.habit-row').first()).toBeVisible();
};
const habitOrder = (page: Page): Promise<string[]> =>
  page.locator('.habit-row .habit-name').allTextContents();

/**
 * Reorders the list in the real UI. `variant` 0 moves the first entry below
 * the second, variant 1 moves the last entry above the first, so the two
 * devices of a competing crossing write different orders.
 */
export const reorder = async (
  page: Page,
  list: ListName,
  variant: 0 | 1,
): Promise<void> => {
  if (list === 'habits') {
    await openHabits(page);
    const before = await habitOrder(page);
    const rowsLoc = page.locator('.habit-row');
    const count = await rowsLoc.count();
    const handle = (i: number): ReturnType<Page['locator']> => rowsLoc.nth(i);
    if (variant === 0) await drag(page, handle(0), handle(1), true);
    else await drag(page, handle(count - 1), handle(0), false);
    await expect.poll(() => habitOrder(page)).not.toEqual(before);
    return;
  }
  await openNotes(page, list);
  const before = await visibleNotes(page);
  const first = before[0];
  const last = before[before.length - 1];
  if (variant === 0) {
    await drag(
      page,
      page.locator(`#n-${first} .handle-drag`),
      page.locator(`#n-${before[1]}`),
      true,
    );
  } else {
    await drag(
      page,
      page.locator(`#n-${last} .handle-drag`),
      page.locator(`#n-${first}`),
      false,
    );
  }
  await expect.poll(() => visibleNotes(page)).not.toEqual(before);
};

/** The order the UI renders: note ids, or the enabled habits' titles (their ids). */
export const renderedOrder = async (page: Page, list: ListName): Promise<string[]> => {
  if (list === 'habits') {
    await openHabits(page);
    return habitOrder(page);
  }
  await openNotes(page, list);
  return visibleNotes(page);
};

/** Adds a project note in the real UI and returns its id. */
export const addNoteInUi = async (page: Page, content: string): Promise<string> => {
  await openNotes(page);
  const before = await visibleNotes(page);
  await new NotePage(page).addNote(content);
  await expect
    .poll(async () => (await visibleNotes(page)).length)
    .toBe(before.length + 1);
  return (await visibleNotes(page)).find((id) => !before.includes(id))!;
};

/**
 * Edits one listed entity in the real UI: renames a habit (titled by its id in
 * the fixture, or by `current`) or replaces a project note's content.
 */
export const editListed = async (
  page: Page,
  list: ListName,
  id: string,
  value: string,
  current = id,
): Promise<void> => {
  if (list === 'habits') {
    await openHabits(page);
    await page
      .locator('.habit-row .habit-title')
      .filter({ has: page.getByText(current, { exact: true }) })
      .click();
    const dialog = page.locator('dialog-simple-counter-edit-settings');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Title' }).fill(value);
    await dialog.getByRole('button', { name: /Save/ }).click();
    await expect(dialog).toBeHidden();
    return;
  }
  await openNotes(page, list);
  await new NotePage(page).editNote(page.locator(`#n-${id} note`), value);
};

export const removeNote = async (page: Page, id: string): Promise<void> => {
  await openNotes(page);
  const note = page.locator(`#n-${id}`);
  await new NotePage(page).deleteNote(note);
  await expect(note).toBeHidden();
};

// ---------------------------------------------------------------------------
// Fixture seeds
// ---------------------------------------------------------------------------

export const seeds = (list: ListName, ids: string[]): Record<string, unknown>[] =>
  list === 'habits'
    ? ids.map((id, index) =>
        persistent('[SimpleCounter] Add SimpleCounter', 'SIMPLE_COUNTER', id, {
          simpleCounter: {
            id,
            title: id,
            // Outside the enabled-only drag, its slot must stay.
            isEnabled: index !== 2,
            icon: null,
            type: 'ClickCounter',
            countOnDay: {},
            isOn: false,
          },
        }),
      )
    : // addNote prepends to both lists, so add in reverse for fixture order.
      [...ids].reverse().map((id, index) =>
        persistent('[Note] Add Note', 'NOTE', id, {
          note: {
            id,
            projectId: PROJECT,
            isPinnedToToday: true,
            content: `Synthetic note ${ids.length - index}`,
            created: 100,
            modified: 100,
          },
          isPreventFocus: true,
        }),
      );
