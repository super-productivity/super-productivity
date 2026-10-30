import type { Browser, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { CompactOperationLogEntry } from '../../../src/app/op-log/persistence/compact/compact-operation.types';
import { expect, test } from '../../fixtures/supersync.fixture';
import { NotePage } from '../../pages/note.page';
import { TagPage } from '../../pages/tag.page';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * One structural rule: a reorder writes one ordered list per context; a
 * concurrent single-entity edit that keeps the entity's identity and whose
 * reducer writes neither that list nor its membership commutes with it.
 *
 * Both crossing actions come from the real UI; only the baseline is seeded
 * through the store. The strict sync helper fails on the whole-dataset
 * "Sync: Conflicting Data" dialog and never picks Keep local or Keep remote.
 * Either device's order may win; both devices must converge and the edit and
 * the unrelated work of both devices must survive. Today membership against a
 * tag order stays behind the safety stop, which must lose nothing.
 */
type Row = CompactOperationLogEntry;
type Entity = Record<string, unknown>;
interface Slice {
  ids: string[];
  entities: Record<string, Entity>;
}
interface Snapshot {
  /** The ordered list the reorder writes, restricted to the fixture's ids. */
  order: string[];
  /** A second list (notes: the other note list) or the full list with foreign slots. */
  other: string[];
  entities: Record<string, Entity>;
  tasks: string[];
}
type ListName = 'project notes' | 'Today notes' | 'tag notes' | 'sections' | 'habits';
type EditName =
  | 'pin'
  | 'unpin'
  | 'lock'
  | 'unlock'
  | 'content'
  | 'collapse'
  | 'expand'
  | 'settings'
  | 'disable';
interface Crossing {
  list: ListName;
  edit: EditName;
}

const PROJECT = 'INBOX_PROJECT';
const EDITED = 'edited concurrently';
const COUNT_DAY = '2026-09-20';

const dispatch = async (
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
  opType = 'CRT',
): Record<string, unknown> => ({
  type,
  ...payload,
  meta: { isPersistent: true, entityType, entityId, opType },
});

const readSlices = (
  page: Page,
): Promise<{
  note: Slice & { todayOrder: string[] };
  projectNoteIds: string[];
  section: Slice;
  simpleCounter: Slice;
  tag: Slice;
  tasks: string[];
}> =>
  page.evaluate((projectId) => {
    type State = {
      note: Slice & { todayOrder: string[] };
      projects: { entities: Record<string, { noteIds: string[] }> };
      section: Slice;
      simpleCounter: Slice;
      tag: Slice;
      tasks: { entities: Record<string, { title: string }> };
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
    return {
      note: state.note,
      projectNoteIds: state.projects.entities[projectId].noteIds,
      section: state.section,
      simpleCounter: state.simpleCounter,
      tag: state.tag,
      tasks: Object.values(state.tasks.entities)
        .map((t) => t.title)
        .sort(),
    };
  }, PROJECT);

const snapshot = async (page: Page, list: ListName, ids: string[]): Promise<Snapshot> => {
  const s = await readSlices(page);
  const pick = (entities: Record<string, Entity>): Record<string, Entity> =>
    Object.fromEntries(ids.map((id) => [id, entities[id]]));
  if (list === 'sections') {
    return {
      order: s.section.ids.filter((id) => ids.includes(id)),
      other: s.section.ids,
      entities: pick(s.section.entities),
      tasks: s.tasks,
    };
  }
  if (list === 'habits') {
    return {
      order: s.simpleCounter.ids.filter((id) => ids.includes(id)),
      other: s.simpleCounter.ids,
      entities: pick(s.simpleCounter.entities),
      tasks: s.tasks,
    };
  }
  const project = s.projectNoteIds.filter((id) => ids.includes(id));
  const today = s.note.todayOrder.filter((id) => ids.includes(id));
  return {
    order: list === 'project notes' ? project : today,
    other: list === 'project notes' ? today : project,
    entities: pick(s.note.entities),
    tasks: s.tasks,
  };
};

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
const fullStateOps = (entries: Row[]): string[] =>
  entries
    .filter((r) => ['REPAIR', 'SYNC_IMPORT', 'BACKUP_IMPORT'].includes(r.op.o))
    .map((r) => r.op.id)
    .sort();

/** Strict: a real successful download, then no dialog/error and nothing pending. */
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
                (await client.sync.syncConfirmedIcon.isVisible())
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

// ---------------------------------------------------------------------------
// Real UI actions
// ---------------------------------------------------------------------------

/** Drag a real section header handle above another one (y-locked CDK list). */
const dragAbove = async (
  page: Page,
  source: ReturnType<Page['locator']>,
  target: ReturnType<Page['locator']>,
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
  await page.mouse.move(x, y - 8, { steps: 3 });
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  await page.mouse.move(to.x + halfToWidth, to.y + 4, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toBeHidden();
};

const openNotes = async (page: Page, route: string): Promise<void> => {
  await page.goto(`/#/${route}/tasks`);
  await waitForAppReady(page, { ensureRoute: false });
  await new NotePage(page).ensureNotesVisible();
  await expect(page.locator('notes .notes')).toBeVisible();
};
const visibleNotes = (page: Page): Promise<string[]> =>
  page
    .locator('notes .notes > div[id^="n-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id.slice(2)));

const noteRoute = (list: ListName, tagId: string): string =>
  list === 'project notes'
    ? `project/${PROJECT}`
    : list === 'Today notes'
      ? 'tag/TODAY'
      : `tag/${tagId}`;

const dragNotes = async (page: Page, route: string): Promise<string[]> => {
  await openNotes(page, route);
  const [first, second, ...rest] = await visibleNotes(page);
  // Same gesture as supersync-note-today-pin-reorder.spec.ts.
  const source = page.locator(`#n-${first} .handle-drag`);
  const target = page.locator(`#n-${second}`);
  await source.hover();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Note drag targets missing');
  const halfSourceWidth = from.width / 2;
  const halfSourceHeight = from.height / 2;
  const halfTargetWidth = to.width / 2;
  const x = from.x + halfSourceWidth;
  const y = from.y + halfSourceHeight;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8);
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  await page.mouse.move(to.x + halfTargetWidth, to.y + to.height - 4, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toBeHidden();
  const expected = [second, first, ...rest];
  await expect.poll(() => visibleNotes(page)).toEqual(expected);
  return expected;
};

const editNote = async (page: Page, id: string, edit: EditName): Promise<void> => {
  await openNotes(page, `project/${PROJECT}`);
  const note = page.locator(`#n-${id}`);
  await note.hover();
  if (edit === 'pin' || edit === 'unpin') {
    await note
      .locator(
        edit === 'pin'
          ? 'button:has(mat-icon:text-is("wb_sunny"))'
          : 'button:has(mat-icon[data-mat-icon-name="remove_today"])',
      )
      .click();
  } else if (edit === 'lock' || edit === 'unlock') {
    await note.locator('button:has(mat-icon:text-is("more_vert"))').click();
    await page
      .locator('.mat-mdc-menu-content button')
      .filter({
        has: page.locator(
          `mat-icon:text-is("${edit === 'lock' ? 'lock_open' : 'lock'}")`,
        ),
      })
      .click();
  } else {
    await new NotePage(page).editNote(note.locator('note'), EDITED);
  }
};

const openProjectWorkView = async (page: Page): Promise<void> => {
  await page.goto(`/#/project/${PROJECT}/tasks`);
  await waitForAppReady(page, { ensureRoute: false });
  // The route's warpRoute animation keeps the leaving work view (e.g. Today) in
  // the DOM next to the entering one until it finishes; wait for it to go.
  await expect(page.locator('.sections-wrapper')).toHaveCount(1);
  await expect(page.locator('.sections-wrapper')).toBeVisible();
};
const sectionHeader = (page: Page, title: string): ReturnType<Page['locator']> =>
  page
    .locator('.section-container')
    .filter({ has: page.locator('.collapsible-title', { hasText: title }) });

const dragSections = async (page: Page, ids: string[]): Promise<void> => {
  await openProjectWorkView(page);
  // Drag Beta's real header handle above Alpha.
  await dragAbove(
    page,
    sectionHeader(page, ids[1]).locator('.collapsible-title.is-drag-handle'),
    sectionHeader(page, ids[0]).locator('.collapsible-title.is-drag-handle'),
  );
  await expect
    .poll(async () =>
      (await readSlices(page)).section.ids.filter((id) =>
        [ids[0], ids[1], ids[2]].includes(id),
      ),
    )
    .toEqual([ids[1], ids[0], ids[2]]);
};
const toggleSection = async (page: Page, id: string): Promise<void> => {
  await openProjectWorkView(page);
  await sectionHeader(page, id).locator('.collapsible-expand-icon').click();
};

const openHabits = async (page: Page): Promise<void> => {
  await page.goto('/#/habits');
  await waitForAppReady(page, { routeRegex: /#\/habits/, selector: '.habit-grid' });
  await expect(page.locator('.habit-row')).toHaveCount(3);
};
const habitOrder = (page: Page): Promise<string[]> =>
  page.locator('.habit-row .habit-name').allTextContents();
/** Same CDK gesture as the reorder wedge spec, including its enabled-only footprint. */
const dragHabits = async (page: Page): Promise<void> => {
  await openHabits(page);
  const before = await habitOrder(page);
  const from = await page.locator('.habit-row').last().boundingBox();
  const to = await page.locator('.habit-row').first().boundingBox();
  if (!from || !to) throw new Error('Habit drag targets missing');
  const halfHeight = from.height / 2;
  const centerY = from.y + halfHeight;
  await page.mouse.move(from.x + 30, centerY);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, centerY - 10, { steps: 3 });
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  await page.mouse.move(to.x + 30, to.y + 5, { steps: 25 });
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toBeHidden();
  await expect.poll(() => habitOrder(page)).not.toEqual(before);
};
const editHabitSettings = async (
  page: Page,
  title: string,
  edit: EditName,
): Promise<void> => {
  await openHabits(page);
  await page
    .locator('.habit-row .habit-title')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  const dialog = page.locator('dialog-simple-counter-edit-settings');
  await expect(dialog).toBeVisible();
  if (edit === 'disable') {
    const enabled = dialog.getByRole('switch', { name: 'Enabled', exact: true });
    await expect(enabled).toBeChecked();
    await enabled.click();
    await expect(enabled).not.toBeChecked();
  } else {
    await dialog.getByRole('textbox', { name: 'Title' }).fill(EDITED);
  }
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(dialog).toBeHidden();
};

// ---------------------------------------------------------------------------
// Fixture seeds
// ---------------------------------------------------------------------------

const noteSeeds = (ids: string[], edit: EditName): Record<string, unknown>[] =>
  [...ids.entries()].reverse().map(([index, id]) =>
    persistent('[Note] Add Note', 'NOTE', id, {
      note: {
        id,
        projectId: index === 3 ? null : PROJECT,
        // The target starts unpinned only when the crossing pins it.
        isPinnedToToday: index !== 0 || edit !== 'pin',
        content: `Synthetic note ${index}`,
        ...(index === 0 && edit === 'unlock' ? { isLock: true } : {}),
        created: 100,
        modified: 100,
      },
      isPreventFocus: true,
    }),
  );

const sectionSeeds = (ids: string[], edit: EditName): Record<string, unknown>[] =>
  // A foreign-context section sits between Alpha and Beta in section.ids.
  [ids[0], ids[3], ids[1], ids[2]].map((id) =>
    persistent('[Section] Add Section', 'SECTION', id, {
      section: {
        id,
        title: id,
        contextId: id === ids[3] ? 'TODAY' : PROJECT,
        contextType: id === ids[3] ? 'TAG' : 'PROJECT',
        taskIds: [],
        ...(id === ids[0] ? { isExpanded: edit !== 'expand' } : {}),
      },
    }),
  );

const habitSeeds = (ids: string[]): Record<string, unknown>[] =>
  ids.map((id, index) =>
    persistent('[SimpleCounter] Add SimpleCounter', 'SIMPLE_COUNTER', id, {
      simpleCounter: {
        id,
        title: id,
        // ids[1] is disabled: outside the enabled-only drag, its slot must stay.
        isEnabled: index !== 1,
        icon: null,
        // A type the receiver's default-field repair could not restore.
        type: index === 0 ? 'StopWatch' : 'ClickCounter',
        countOnDay: Object.fromEntries([[COUNT_DAY, index + 1]]),
        isOn: false,
      },
    }),
  );

// ---------------------------------------------------------------------------
// Crossing harness
// ---------------------------------------------------------------------------

interface Harness {
  clients: SimulatedE2EClient[];
  logs: string[];
  evidence: Record<string, unknown>;
}
interface RunFixtures {
  browser: Browser;
  baseURL: string | undefined;
  testRunId: string;
}
type SyncConfig = ReturnType<typeof getSuperSyncConfig>;

const orderCode = (list: ListName): string =>
  list === 'sections' ? 'S4' : list === 'habits' ? 'SM' : 'NO';
const editCode = (list: ListName): string =>
  list === 'sections' ? 'S3' : list === 'habits' ? 'SU' : 'NU';

const join = async (
  { browser, testRunId }: RunFixtures,
  harness: Harness,
  config: SyncConfig,
  clientName: string,
  url: string,
  released = false,
): Promise<SimulatedE2EClient> => {
  const client = await createSimulatedClient(
    browser,
    url,
    clientName,
    testRunId,
    released ? { serviceWorkers: 'block' } : {},
  );
  harness.clients.push(client);
  client.page.on('console', (m) => harness.logs.push(`${clientName}: ${m.text()}`));
  await client.sync.setupSuperSync(config);
  await client.page.addInitScript(() => {
    const flags = window as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });
  return client;
};

const fixtureIds = (list: ListName, testRunId: string): string[] =>
  (list === 'sections'
    ? ['Alpha', 'Beta', 'Untouched', 'Foreign']
    : list === 'habits'
      ? ['target', 'disabled', 'sibling', 'untouched']
      : ['target', 'sibling', 'witness', 'today-only']
  ).map((id) => `${id}-${testRunId}`);

const seedsFor = (
  list: ListName,
  ids: string[],
  edit: EditName,
): Record<string, unknown>[] =>
  list === 'sections'
    ? sectionSeeds(ids, edit)
    : list === 'habits'
      ? habitSeeds(ids)
      : noteSeeds(ids, edit);

/** Performs one side of the crossing in the real UI and returns its pending op. */
const perform = async (
  client: SimulatedE2EClient,
  isOrder: boolean,
  { list, edit }: Crossing,
  ids: string[],
  tagId: string,
): Promise<Row['op']> => {
  if (isOrder) {
    if (list === 'sections') await dragSections(client.page, ids);
    else if (list === 'habits') await dragHabits(client.page);
    else await dragNotes(client.page, noteRoute(list, tagId));
  } else if (list === 'sections') {
    await toggleSection(client.page, ids[0]);
  } else if (list === 'habits') {
    await editHabitSettings(client.page, ids[0], edit);
  } else {
    await editNote(client.page, ids[0], edit);
  }
  const code = isOrder ? orderCode(list) : editCode(list);
  await expect
    .poll(async () => pending(await rows(client.page)).filter((r) => r.op.a === code))
    .toHaveLength(1);
  return pending(await rows(client.page)).find((r) => r.op.a === code)!.op;
};

interface CrossingRun {
  a: SimulatedE2EClient;
  b: SimulatedE2EClient;
  ids: string[];
  before: Snapshot;
  edited: Snapshot;
  reordered: Snapshot;
  order: Row['op'];
  fullStateBefore: Set<string>;
  config: SyncConfig;
}

/**
 * Seeds A, joins B and performs both real UI actions in timestamp order. The
 * order is pending on A when `pendingOrder`, else the edit is; B uploads first.
 */
const runCrossing = async (
  fixtures: RunFixtures,
  harness: Harness,
  crossing: Crossing,
  pendingOrder: boolean,
  incomingNewer: boolean,
): Promise<CrossingRun> => {
  const { list, edit } = crossing;
  const { testRunId } = fixtures;
  const config = getSuperSyncConfig(await createTestUser(testRunId));
  const a = await join(fixtures, harness, config, 'A', fixtures.baseURL!);
  const ids = fixtureIds(list, testRunId);
  let tagId = '';
  if (list === 'tag notes') {
    // Any user tag view lists note.todayOrder in its notes panel.
    const tagTitle = `Reorder tag ${testRunId}`;
    await new TagPage(a.page).createTag(tagTitle);
    const findTag = async (): Promise<string | undefined> => {
      const { tag } = await readSlices(a.page);
      return tag.ids.find((id) => tag.entities[id]?.title === tagTitle);
    };
    await expect.poll(findTag).toBeTruthy();
    tagId = (await findTag())!;
  }
  await dispatch(a.page, seedsFor(list, ids, edit));
  await sync(a);
  const b = await join(fixtures, harness, config, 'B', fixtures.baseURL!);
  await sync(b);
  await sync(a);
  const before = await snapshot(a.page, list, ids);
  expect(await snapshot(b.page, list, ids)).toEqual(before);
  const fullStateBefore = new Set([
    ...fullStateOps(await rows(a.page)),
    ...fullStateOps(await rows(b.page)),
  ]);
  // Unrelated work on both devices must survive the crossing.
  await a.workView.addTask(`local witness ${testRunId}`);
  await b.workView.addTask(`remote witness ${testRunId}`);

  const orderClient = pendingOrder ? a : b;
  const editClient = pendingOrder ? b : a;
  // Change real UI action order, not timestamps or stored rows.
  const ops = new Map<SimulatedE2EClient, Row['op']>();
  for (const client of incomingNewer ? [a, b] : [b, a])
    ops.set(client, await perform(client, client === orderClient, crossing, ids, tagId));
  const order = ops.get(orderClient)!;
  const update = ops.get(editClient)!;
  expect(order).toMatchObject({ o: 'MOV', d: order.ds![0] });
  expect(update).toMatchObject({ o: 'UPD', d: ids[0], ds: [ids[0]] });
  // The edited entity is a declared, non-primary id of the reorder.
  expect(order.ds).toContain(ids[0]);
  expect(order.ds!.length).toBeGreaterThan(1);
  if (list === 'tag notes') {
    expect(order.p).toMatchObject({
      actionPayload: { activeContextType: 'TAG', activeContextId: tagId },
    });
  }
  const local = pendingOrder ? order : update;
  const remote = pendingOrder ? update : order;
  expect(remote.t > local.t).toBe(incomingNewer);
  const keys = new Set([...Object.keys(local.v), ...Object.keys(remote.v)]);
  expect([...keys].some((k) => (local.v[k] || 0) > (remote.v[k] || 0))).toBe(true);
  expect([...keys].some((k) => (local.v[k] || 0) < (remote.v[k] || 0))).toBe(true);
  const edited = await snapshot(editClient.page, list, ids);
  const reordered = await snapshot(orderClient.page, list, ids);
  expect(edited.entities[ids[0]]).not.toEqual(before.entities[ids[0]]);
  harness.evidence.beforeCrossing = { order, update, edited, reordered };
  return { a, b, ids, before, edited, reordered, order, fullStateBefore, config };
};

/** Records the stop's diagnostics; never answers the Conflicting Data dialog. */
const recordStop = async (
  client: SimulatedE2EClient,
  harness: Harness,
): Promise<void> => {
  harness.evidence.safetyStop = harness.logs.filter(
    (l) =>
      l.startsWith(`${client.clientName}: `) &&
      l.includes('SYNC_MULTI_ENTITY_UNSUPPORTED'),
  );
  // The manual-sync dialog can follow the error icon; record it, never answer it.
  await client.sync.conflictDialog
    .waitFor({ state: 'visible', timeout: 5000 })
    .catch(() => undefined);
  harness.evidence.dialog = (await client.sync.conflictDialog.isVisible())
    ? await client.sync.conflictDialog.innerText()
    : null;
};

const withHarness = async (
  evidence: Record<string, unknown>,
  outputPath: string,
  body: (harness: Harness) => Promise<void>,
): Promise<void> => {
  const harness: Harness = { clients: [], logs: [], evidence };
  try {
    await body(harness);
  } finally {
    await writeFile(outputPath, JSON.stringify(harness.evidence, null, 2));
    for (const client of harness.clients) await closeClient(client);
  }
};

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

const crossings: Crossing[] = [
  // 1. Pin/unpin write note.todayOrder, not the project list the order writes.
  { list: 'project notes', edit: 'pin' },
  { list: 'project notes', edit: 'unpin' },
  // 2. In-place note fields, in every context.
  { list: 'project notes', edit: 'lock' },
  { list: 'Today notes', edit: 'unlock' },
  // 3. Section expansion is an in-place field.
  { list: 'sections', edit: 'collapse' },
  { list: 'sections', edit: 'expand' },
  // 4. Habit settings, including disabling a listed habit.
  { list: 'habits', edit: 'settings' },
  { list: 'habits', edit: 'disable' },
  // 5. A non-TODAY tag view shows and reorders note.todayOrder too.
  { list: 'tag notes', edit: 'content' },
];

for (const crossing of crossings) {
  for (const pendingOrder of [true, false]) {
    for (const incomingNewer of [true, false]) {
      const name =
        `@supersync reorder rule: ${crossing.list} vs ${crossing.edit}` +
        ` / local-${pendingOrder ? 'order' : 'edit'}` +
        ` / incoming-${incomingNewer ? 'newer' : 'older'}`;
      test(name, async ({ browser, baseURL, testRunId }, testInfo) => {
        test.setTimeout(240000);
        const { list } = crossing;
        const evidence = { crossing, pendingOrder, incomingNewer };
        await withHarness(
          evidence,
          testInfo.outputPath('evidence.json'),
          async (harness) => {
            const fixtures = { browser, baseURL, testRunId };
            const { a, b, ids, before, edited, fullStateBefore, config } =
              await runCrossing(fixtures, harness, crossing, pendingOrder, incomingNewer);

            // B uploads first; A resolves while its own crossing op is pending.
            await sync(b);
            const outcome = await syncOutcome(a);
            harness.evidence.outcome = outcome;
            if (outcome !== 'in-sync') await recordStop(a, harness);
            expect(
              outcome,
              `must sync without the safety stop: ${JSON.stringify(harness.evidence.safetyStop ?? [])}`,
            ).toBe('in-sync');
            await sync(b);
            await sync(a);

            const final = await snapshot(a.page, list, ids);
            expect(await snapshot(b.page, list, ids)).toEqual(final);
            // The edit survives on the entity, every other entity is untouched.
            expect(final.entities).toEqual({
              ...before.entities,
              [ids[0]]: edited.entities[ids[0]],
            });
            // One converged, unique order over the same members (either winner).
            expect(new Set(final.order).size).toBe(final.order.length);
            expect([...final.order].sort()).toEqual([...before.order].sort());
            if (list.endsWith('notes')) {
              expect(new Set(final.other).size).toBe(final.other.length);
              expect([...final.other].sort()).toEqual(
                [...(list === 'project notes' ? edited.other : before.other)].sort(),
              );
            } else {
              // Foreign-context / disabled slots keep their absolute position.
              const fixed = ids[list === 'sections' ? 3 : 1];
              expect(final.other.indexOf(fixed)).toBe(before.other.indexOf(fixed));
            }
            if (list === 'habits') expect(final.entities[ids[0]].type).toBe('StopWatch');
            expect(final.tasks).toEqual(
              expect.arrayContaining([
                expect.stringContaining(`local witness ${testRunId}`),
                expect.stringContaining(`remote witness ${testRunId}`),
              ]),
            );

            for (const client of [a, b]) {
              const entries = await rows(client.page);
              expect(pending(entries)).toEqual([]);
              expect(fullStateOps(entries).every((id) => fullStateBefore.has(id))).toBe(
                true,
              );
              await client.page.reload();
              await waitForAppReady(client.page, { ensureRoute: false });
              expect(await snapshot(client.page, list, ids)).toEqual(final);
              await sync(client);
            }
            const fresh = await join(fixtures, harness, config, 'Fresh', baseURL!);
            await sync(fresh);
            expect(await snapshot(fresh.page, list, ids)).toEqual(final);
            expect(
              fullStateOps(await rows(fresh.page)).every((id) => fullStateBefore.has(id)),
            ).toBe(true);
          },
        );
      });
    }
  }
}

// A tag order carries note.todayOrder, which released reducers overwrite with
// it; Today membership against it stays behind the safety stop (#10342).
test('@supersync reorder rule: Today notes vs unpin keeps the stop, nothing lost', async ({
  browser,
  baseURL,
  testRunId,
}, testInfo) => {
  test.setTimeout(240000);
  const crossing: Crossing = { list: 'Today notes', edit: 'unpin' };
  await withHarness(
    { crossing },
    testInfo.outputPath('evidence.json'),
    async (harness) => {
      const { a, b, ids, edited, reordered, order } = await runCrossing(
        { browser, baseURL, testRunId },
        harness,
        crossing,
        true,
        true,
      );
      await sync(b);
      const outcome = await syncOutcome(a);
      harness.evidence.outcome = outcome;
      await recordStop(a, harness);
      expect(outcome).not.toBe('in-sync');
      expect(harness.evidence.safetyStop).toEqual(
        expect.arrayContaining([
          expect.stringContaining('side=local actionType=[Note] Update Note Order'),
        ]),
      );
      // A keeps its pending order and its own state; B keeps the synced unpin.
      expect(pending(await rows(a.page)).map((r) => r.op.id)).toContain(order.id);
      const lists = ({ order: o, other, entities }: Snapshot): object => ({
        order: o,
        other,
        entities,
      });
      expect(lists(await snapshot(a.page, crossing.list, ids))).toEqual(lists(reordered));
      expect(lists(await snapshot(b.page, crossing.list, ids))).toEqual(lists(edited));
      expect(pending(await rows(b.page))).toEqual([]);
    },
  );
});

// The causal proof is one retained, applied, synced remote row. Compaction can
// remove it while the pin stays pending behind a lost upload. Without that proof
// a pin keeps the whole-note snapshot fallback instead of stopping sync, whose
// only way out replaces one side's data.
test('@supersync reorder rule: project notes vs pin without causal proof keeps syncing', async ({
  browser,
  baseURL,
  testRunId,
}, testInfo) => {
  test.setTimeout(300000);
  const crossing: Crossing = { list: 'project notes', edit: 'pin' };
  await withHarness(
    { crossing },
    testInfo.outputPath('evidence.json'),
    async (harness) => {
      const { a, b, ids, order, fullStateBefore } = await runCrossing(
        { browser, baseURL, testRunId },
        harness,
        crossing,
        false,
        true,
      );
      let offline = false;
      let allowUpload = false;
      await a.page.route('**/api/sync/**', async (route) => {
        if (offline || (!allowUpload && route.request().method() === 'POST'))
          await route.abort();
        else await route.continue();
      });
      await sync(b);
      // A downloads and admits B's order, then loses its upload.
      const blockedUpload = a.page.waitForRequest(
        (request) =>
          request.url().includes('/api/sync/ops') && request.method() === 'POST',
      );
      await a.sync.clickSyncBtn();
      await blockedUpload;
      await expect(a.sync.syncSpinner).toBeHidden();
      const entries = await rows(a.page);
      const pin = pending(entries).find((r) => r.op.a === 'NU')!;
      const remote = entries.find((r) => r.op.id === order.id)!;
      expect(remote.applicationStatus).toBe('applied');
      const lists = ({ order: o, other, entities }: Snapshot): object => ({
        order: o,
        other,
        entities,
      });
      const interrupted = lists(await snapshot(a.page, crossing.list, ids));

      // Age only application metadata; the production compactor removes the row.
      offline = true;
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
      const taskId = entries.find(
        (r) => r.source === 'local' && r.op.e === 'TASK' && r.op.o === 'CRT',
      )!.op.d!;
      await dispatch(
        a.page,
        Array.from({ length: 500 }, (_, i) =>
          persistent(
            '[Task Shared] updateTask',
            'TASK',
            taskId,
            { task: { id: taskId, changes: { title: `Offline activity ${i}` } } },
            'UPD',
          ),
        ),
      );
      await expect
        .poll(async () => (await rows(a.page)).some((r) => r.op.id === order.id), {
          timeout: 60000,
        })
        .toBe(false);
      await a.page.reload();
      await waitForAppReady(a.page, { ensureRoute: false });
      expect(lists(await snapshot(a.page, crossing.list, ids))).toEqual(interrupted);

      offline = false;
      allowUpload = true;
      const outcome = await syncOutcome(a);
      harness.evidence.outcome = outcome;
      if (outcome !== 'in-sync') await recordStop(a, harness);
      expect(
        outcome,
        `a pin without causal proof must not stop sync: ${JSON.stringify(harness.evidence.safetyStop ?? [])}`,
      ).toBe('in-sync');
      await sync(a);
      await sync(b);
      await sync(a);

      const finalA = await snapshot(a.page, crossing.list, ids);
      const finalB = await snapshot(b.page, crossing.list, ids);
      expect(finalA.entities[ids[0]].isPinnedToToday).toBe(true);
      // Applying an LWW snapshot stamps the receiver's own `modified` by design
      // (lwwUpdateMetaReducer); every other field must match.
      const unstamped = (entities: Record<string, Entity>): Record<string, Entity> =>
        Object.fromEntries(
          Object.entries(entities).map(([id, entity]) => [
            id,
            { ...entity, modified: undefined },
          ]),
        );
      expect(unstamped(finalB.entities)).toEqual(unstamped(finalA.entities));
      expect(finalB.order).toEqual(finalA.order);
      expect(
        (await rows(a.page)).find((r) => r.op.id === pin.op.id)?.rejectedAt,
      ).toBeDefined();
      for (const client of [a, b]) {
        const all = await rows(client.page);
        expect(pending(all)).toEqual([]);
        expect(fullStateOps(all).every((id) => fullStateBefore.has(id))).toBe(true);
      }
      // The LWW snapshot replacement keeps note.todayOrder in step with
      // isPinnedToToday (#10659, #10379), so B's Today list shows the pin too.
      expect(finalA.other).toContain(ids[0]);
      expect(finalB.other).toContain(ids[0]);
    },
  );
});

// ---------------------------------------------------------------------------
// Released receivers and producers (unmodified v18.15–v19.1 bundle)
// ---------------------------------------------------------------------------

/** Note ids as the released notes panel renders them, duplicates included. */
const renderedNotes = async (page: Page, route: string): Promise<string[]> => {
  await page.goto(`/#/${route}/tasks`);
  await new NotePage(page).ensureNotesVisible();
  await expect(page.locator('notes .notes')).toBeVisible();
  return page
    .locator('notes [cdkdrag]')
    .evaluateAll((nodes) => nodes.map((node) => node.id.slice(2)));
};

test.describe('@supersync released reorder rule (#10364)', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    // A free port: other released suites may serve their bundle concurrently.
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  for (const releasedPins of [false, true]) {
    test(
      releasedPins
        ? 'released pin uploads first, current reissues its project order'
        : 'current reissues a pin over a project order, released consumes it',
      async ({ browser, baseURL, testRunId }, testInfo) => {
        test.setTimeout(240000);
        await withHarness(
          { releasedPins },
          testInfo.outputPath('evidence.json'),
          async (harness) => {
            const fixtures = { browser, baseURL, testRunId };
            const config = getSuperSyncConfig(await createTestUser(testRunId));
            const ids = fixtureIds('project notes', testRunId);
            const current = await join(fixtures, harness, config, 'A', baseURL!);
            await dispatch(current.page, noteSeeds(ids, 'pin'));
            await sync(current);
            const released = await join(
              fixtures,
              harness,
              config,
              'Released',
              assets.url,
              true,
            );
            await sync(released);
            const other = releasedPins
              ? released
              : await join(fixtures, harness, config, 'B', baseURL!);
            await sync(other);
            await sync(current);
            const versions: (string | null)[] = [];
            released.page.on('request', (request) => {
              if (request.method() === 'GET' && request.url().includes('/api/sync/ops?'))
                versions.push(new URL(request.url()).searchParams.get('appVersion'));
            });
            const route = `project/${PROJECT}`;
            expect((await renderedNotes(released.page, route)).sort()).toEqual(
              ids.slice(0, 3).sort(),
            );

            // The released UI pins in place; the current UI drags or pins.
            if (releasedPins) {
              await perform(
                current,
                true,
                { list: 'project notes', edit: 'pin' },
                ids,
                '',
              );
              const note = released.page.locator(`#n-${ids[0]}`);
              await note.hover();
              await note.locator('button:has(mat-icon:text-is("wb_sunny"))').click();
              await expect
                .poll(async () => pending(await rows(released.page)).map((r) => r.op.a))
                .toContain('NU');
            } else {
              await perform(
                current,
                false,
                { list: 'project notes', edit: 'pin' },
                ids,
                '',
              );
              await perform(other, true, { list: 'project notes', edit: 'pin' }, ids, '');
            }
            await sync(other);
            await sync(current);
            await sync(other);
            await sync(released);
            await sync(current);

            const final = await snapshot(current.page, 'project notes', ids);
            if (!releasedPins)
              expect(await snapshot(other.page, 'project notes', ids)).toEqual(final);
            expect(final.entities[ids[0]].isPinnedToToday).toBe(true);
            expect(final.other.filter((id) => id === ids[0])).toHaveLength(1);
            const rejected = (await rows(current.page)).filter(
              (r) => r.source === 'local' && !!r.rejectedAt,
            );
            expect(rejected.map((r) => r.op.a)).toEqual([releasedPins ? 'NO' : 'NU']);
            for (const reload of [false, true]) {
              if (reload) {
                await released.page.reload();
                await waitForAppReady(released.page, { ensureRoute: false });
                await sync(released);
              }
              expect(await renderedNotes(released.page, route)).toEqual(final.order);
              const today = await renderedNotes(released.page, 'tag/TODAY');
              expect(today.filter((id) => ids.includes(id))).toEqual(final.other);
            }
            expect(versions).toContain('19.1.0');
            for (const client of harness.clients)
              expect(pending(await rows(client.page))).toEqual([]);
          },
        );
      },
    );
  }

  test('current reissues habit settings over a habit order, released keeps the type', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    test.setTimeout(240000);
    await withHarness({}, testInfo.outputPath('evidence.json'), async (harness) => {
      const fixtures = { browser, baseURL, testRunId };
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const ids = fixtureIds('habits', testRunId);
      const current = await join(fixtures, harness, config, 'A', baseURL!);
      const today = await current.page.evaluate(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      const seeds = habitSeeds(ids);
      // Two tracked minutes render as "2m" only while the habit is a StopWatch.
      (seeds[0].simpleCounter as Record<string, unknown>).countOnDay = Object.fromEntries(
        [[today, 120000]],
      );
      await dispatch(current.page, seeds);
      await sync(current);
      const other = await join(fixtures, harness, config, 'B', baseURL!);
      await sync(other);
      const released = await join(
        fixtures,
        harness,
        config,
        'Released',
        assets.url,
        true,
      );
      await sync(released);
      const versions: (string | null)[] = [];
      released.page.on('request', (request) => {
        if (request.method() === 'GET' && request.url().includes('/api/sync/ops?'))
          versions.push(new URL(request.url()).searchParams.get('appVersion'));
      });
      const todayValue = async (): Promise<string> => {
        await released.page.goto('/#/habits');
        const row = released.page
          .locator('.habit-row')
          .filter({ has: released.page.getByText(EDITED, { exact: true }) });
        await expect(row).toHaveCount(1);
        return row.locator('.day-cell').nth(6).locator('.value-text').innerText();
      };
      await perform(current, false, { list: 'habits', edit: 'settings' }, ids, '');
      await perform(other, true, { list: 'habits', edit: 'settings' }, ids, '');
      await sync(other);
      await sync(current);
      await sync(other);
      await sync(released);
      const final = await snapshot(current.page, 'habits', ids);
      expect(await snapshot(other.page, 'habits', ids)).toEqual(final);
      expect(final.entities[ids[0]]).toMatchObject({ title: EDITED, type: 'StopWatch' });
      expect(
        (await rows(current.page))
          .filter((r) => r.source === 'local' && !!r.rejectedAt)
          .map((r) => r.op.a),
      ).toEqual(['SU']);
      expect(await todayValue()).toBe('2m');
      await released.page.reload();
      await sync(released);
      expect(await todayValue()).toBe('2m');
      expect(await habitOrder(released.page)).toEqual(
        final.order
          .filter((id) => id !== ids[1])
          .map((id) => (id === ids[0] ? EDITED : id)),
      );
      expect(versions).toContain('19.1.0');
    });
  });
});
