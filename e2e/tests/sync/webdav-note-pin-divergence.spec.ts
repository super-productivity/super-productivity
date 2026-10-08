import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import type { NoteState } from '../../../src/app/features/note/note.model';
import type { CompactOperationLogEntry } from '../../../src/app/op-log/persistence/compact/compact-operation.types';
import { expect, test } from '../../fixtures/webdav.fixture';
import { NotePage } from '../../pages/note.page';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
  type WebDavConfig,
} from '../../utils/sync-helpers';

/**
 * Two ways two WebDAV devices can permanently disagree about one note.
 *
 * NOTE has no RECREATE_FALLBACK entry, so ConflictResolutionService refuses the
 * disjoint-field merge: concurrent edits of DIFFERENT fields of one note resolve
 * by whole-entity last-write-wins on op timestamps.
 *
 * (a) Remote newer: the local op is rejected and never uploaded, but the local
 *     state keeps that edit.
 * (b) Local newer: the winner uploads a `[NOTE] LWW Update` carrying the full
 *     note. lwwUpdateMetaReducer replaces the entity without maintaining
 *     `note.todayOrder`, which the Today notes panel renders unfiltered.
 *
 * Both tests assert the correct outcome (both clients agree). They are pending
 * (`test.fixme`) because both divergences exist on master: confirmed 3 of 3
 * runs each (2026-09). The PR that fixes one enables its test. (a) is #10260
 * for notes; (b) is part of #10379. The sync fuzz harness pins both in
 * sync-fuzz-pinned-traces.json. All edits go through the real UI.
 */

type OpRow = CompactOperationLogEntry;

interface Client {
  name: string;
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
  notes: NotePage;
}

/** What one client believes about the shared note. */
interface NoteView {
  content: string | undefined;
  isPinnedToToday: boolean | undefined;
  inTodayOrder: boolean;
  listedInTodayPanel: boolean;
}

// Only a project note has the pin toggle: a note added in the Today view gets
// `projectId: null` (and is pinned), so it can never be unpinned.
const PROJECT_ID = 'INBOX_PROJECT';
const ORIGINAL = 'Shared note original';
// LWW compares wall-clock op timestamps, so the second edit must be later.
const LWW_GAP_MS = 1_500;

const readNoteState = (page: Page): Promise<NoteState> =>
  page.evaluate(() => {
    let noteState!: NoteState;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (fn: (s: { note: NoteState }) => void) => {
              unsubscribe: () => void;
            };
          };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (noteState = s.note))
      .unsubscribe();
    return noteState;
  });

const readOpRows = (page: Page): Promise<OpRow[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('SUP_OPS');
      open.onsuccess = (): void => resolve(open.result);
      open.onerror = (): void => reject(open.error);
    });
    try {
      return await new Promise<OpRow[]>((resolve, reject) => {
        const read = db.transaction('ops').objectStore('ops').getAll();
        read.onsuccess = (): void => resolve(read.result as OpRow[]);
        read.onerror = (): void => reject(read.error);
      });
    } finally {
      db.close();
    }
  });

const noteOps = async (client: Client, noteId: string): Promise<OpRow[]> =>
  (await readOpRows(client.page)).filter(
    (row) =>
      row.op.e === 'NOTE' && (row.op.d === noteId || !!row.op.ds?.includes(noteId)),
  );

const isPending = (row: OpRow): boolean =>
  row.source === 'local' && !row.syncedAt && !row.rejectedAt;

const describeOps = (rows: OpRow[]): string[] =>
  rows.map(
    (row) =>
      `${row.source} ${row.op.a} t=${row.op.t}` +
      `${row.syncedAt ? ' synced' : ''}${row.rejectedAt ? ' REJECTED' : ''} ` +
      JSON.stringify(row.op.p),
  );

/** Waits for the single pending local op the last UI edit wrote, and returns it. */
const pendingNoteOp = async (client: Client, noteId: string): Promise<OpRow> => {
  await expect
    .poll(async () => (await noteOps(client, noteId)).filter(isPending).length)
    .toBe(1);
  return (await noteOps(client, noteId)).filter(isPending)[0];
};

const syncClient = async (client: Client): Promise<void> => {
  await client.sync.triggerSync();
  expect(await waitForSyncComplete(client.page, client.sync)).toBe('success');
};

const openNotes = async (client: Client, view: 'project' | 'today'): Promise<void> => {
  await client.page.goto(
    view === 'project' ? `/#/project/${PROJECT_ID}/tasks` : '/#/tag/TODAY/tasks',
  );
  await client.work.waitForTaskList();
  await client.notes.ensureNotesVisible();
  await expect(client.page.locator('notes .notes')).toBeVisible();
};

const panelNoteIds = (page: Page): Promise<string[]> =>
  page
    .locator('notes .notes > div[id^="n-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id.slice(2)));

/** Clicks the note's pin toggle in the project view, which lists pinned and unpinned notes. */
const setPinnedToToday = async (
  client: Client,
  noteId: string,
  pinned: boolean,
): Promise<void> => {
  await openNotes(client, 'project');
  const note = client.page.locator(`#n-${noteId} note`);
  await note.hover();
  const toggle = pinned
    ? note
        .locator('button')
        .filter({ has: client.page.locator('mat-icon', { hasText: /^wb_sunny$/ }) })
    : note.locator('button:has(mat-icon[data-mat-icon-name="remove_today"])');
  await toggle.click();
  await expect
    .poll(
      async () => (await readNoteState(client.page)).entities[noteId]?.isPinnedToToday,
    )
    .toBe(pinned);
};

const editContent = async (
  client: Client,
  noteId: string,
  content: string,
): Promise<void> => {
  await openNotes(client, 'project');
  await client.notes.editNote(client.page.locator(`#n-${noteId} note`), content);
  await expect
    .poll(async () => (await readNoteState(client.page)).entities[noteId]?.content)
    .toBe(content);
};

const observe = async (client: Client, noteId: string): Promise<NoteView> => {
  await openNotes(client, 'today');
  const state = await readNoteState(client.page);
  await expect
    .poll(() => panelNoteIds(client.page), {
      message: `${client.name}: the Today notes panel renders note.todayOrder`,
    })
    .toEqual(state.todayOrder);
  const note = state.entities[noteId];
  return {
    content: note?.content,
    isPinnedToToday: note?.isPinnedToToday,
    inTodayOrder: state.todayOrder.includes(noteId),
    listedInTodayPanel: (await panelNoteIds(client.page)).includes(noteId),
  };
};

const createClient = async (
  browser: Browser,
  baseURL: string | undefined,
  name: string,
  config: WebDavConfig,
  contexts: BrowserContext[],
): Promise<Client> => {
  const { context, page } = await setupSyncClient(browser, baseURL);
  contexts.push(context);
  const client: Client = {
    name,
    page,
    sync: new SyncPage(page),
    work: new WorkViewPage(page),
    notes: new NotePage(page),
  };
  await client.work.waitForTaskList();
  await client.sync.setupWebdavSync(config);
  expect(await waitForSyncComplete(page, client.sync)).toBe('success');
  // From here on every sync is an explicit click, in the order the scenario needs.
  await page.evaluate(() => {
    (globalThis as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
  });
  return client;
};

/** A creates a project note and pins it to Today; B then joins. Both see it pinned. */
const setupSharedPinnedNote = async (
  browser: Browser,
  baseURL: string | undefined,
  request: APIRequestContext,
  contexts: BrowserContext[],
): Promise<{ a: Client; b: Client; noteId: string }> => {
  const folder = generateSyncFolderName('e2e-note-pin-divergence');
  await createSyncFolder(request, folder);
  const config: WebDavConfig = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${folder}`,
  };

  const a = await createClient(browser, baseURL, 'A', config, contexts);
  await openNotes(a, 'project');
  await a.notes.addNote(ORIGINAL);
  const findNoteId = async (): Promise<string | undefined> => {
    const state = await readNoteState(a.page);
    return state.ids.find((id) => state.entities[id]?.content === ORIGINAL);
  };
  await expect.poll(findNoteId).toBeDefined();
  const noteId = await findNoteId();
  if (!noteId) throw new Error('Shared note was not created');
  // A note added in a project view is NOT pinned to Today by default.
  expect((await readNoteState(a.page)).entities[noteId]).toMatchObject({
    projectId: PROJECT_ID,
    isPinnedToToday: false,
  });
  await setPinnedToToday(a, noteId, true);
  await syncClient(a);

  const b = await createClient(browser, baseURL, 'B', config, contexts);
  const pinnedEverywhere: NoteView = {
    content: ORIGINAL,
    isPinnedToToday: true,
    inTodayOrder: true,
    listedInTodayPanel: true,
  };
  for (const client of [a, b]) {
    expect(await observe(client, noteId)).toEqual(pinnedEverywhere);
    expect((await noteOps(client, noteId)).filter(isPending)).toEqual([]);
  }
  return { a, b, noteId };
};

const report = async (
  a: Client,
  b: Client,
  noteId: string,
  label: string,
): Promise<Record<'A' | 'B', NoteView>> => {
  const views = { A: await observe(a, noteId), B: await observe(b, noteId) };
  const opLog = {
    A: describeOps(await noteOps(a, noteId)),
    B: describeOps(await noteOps(b, noteId)),
  };
  const body = JSON.stringify({ views, opLog }, null, 2);
  console.log(`[${label}] final note views and op logs:\n${body}`);
  await test.info().attach(`${label}.json`, { body, contentType: 'application/json' });
  return views;
};

test.describe('@webdav note pin divergence after a crossing', () => {
  test.describe.configure({ mode: 'default' });

  test.fixme('(a) remote-newer content edit: the rejected local unpin must not survive locally', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    void webdavServerUp;
    test.slow();
    const contexts: BrowserContext[] = [];
    try {
      const { a, b, noteId } = await setupSharedPinnedNote(
        browser,
        baseURL,
        request,
        contexts,
      );
      const aEdit = 'Content edited on A (newer)';

      // B unpins first; A edits the content later. Neither has synced.
      await setPinnedToToday(b, noteId, false);
      const bUnpin = await pendingNoteOp(b, noteId);
      await b.page.waitForTimeout(LWW_GAP_MS);
      await editContent(a, noteId, aEdit);
      const aContent = await pendingNoteOp(a, noteId);
      expect(bUnpin.op.p).toMatchObject({
        actionPayload: { note: { id: noteId, changes: { isPinnedToToday: false } } },
      });
      expect(aContent.op.p).toMatchObject({
        actionPayload: { note: { id: noteId, changes: { content: aEdit } } },
      });
      expect(aContent.op.t).toBeGreaterThan(bUnpin.op.t);

      await syncClient(a); // uploads the content edit
      await syncClient(b); // remote is newer: B's unpin loses and is rejected
      await syncClient(a);
      await syncClient(b);

      const views = await report(a, b, noteId, 'scenario-a');
      // The crossing really synced: B received A's content edit.
      expect(views.B.content).toBe(aEdit);
      expect(views.B, 'A and B must agree on the shared note').toEqual(views.A);
    } finally {
      await closeContextsSafely(...contexts);
    }
  });

  test.fixme('(b) local-newer unpin: the LWW replacement must also update the Today list', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    void webdavServerUp;
    test.slow();
    const contexts: BrowserContext[] = [];
    try {
      const { a, b, noteId } = await setupSharedPinnedNote(
        browser,
        baseURL,
        request,
        contexts,
      );
      const bEdit = 'Content edited on B (older)';

      // B edits the content first; A unpins later. Neither has synced.
      await editContent(b, noteId, bEdit);
      const bContent = await pendingNoteOp(b, noteId);
      await a.page.waitForTimeout(LWW_GAP_MS);
      await setPinnedToToday(a, noteId, false);
      const aUnpin = await pendingNoteOp(a, noteId);
      expect(aUnpin.op.t).toBeGreaterThan(bContent.op.t);

      await syncClient(b); // uploads the content edit
      await syncClient(a); // local is newer: A emits a [NOTE] LWW Update
      await syncClient(b); // B applies the whole-note replacement
      await syncClient(a);
      await syncClient(b);

      const views = await report(a, b, noteId, 'scenario-b');
      // The crossing really synced: only A's replacement can unpin the note on B.
      expect(views.B.isPinnedToToday).toBe(false);
      expect(
        (await noteOps(a, noteId)).some((row) => row.op.a === '[NOTE] LWW Update'),
      ).toBe(true);
      expect(views.B, 'A and B must agree on the shared note').toEqual(views.A);
    } finally {
      await closeContextsSafely(...contexts);
    }
  });
});
