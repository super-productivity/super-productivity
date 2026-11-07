import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import { NotePage } from '../../pages/note.page';
import { ProjectPage } from '../../pages/project.page';
import {
  closeClient,
  createProjectReliably,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #10718 reproduction: one device deletes a project while another moves a
 * note into it. Whatever the outcome (note deleted with the project, or kept
 * somewhere), every device must end with the same note state, and a note that
 * still exists must be reachable: its project exists and lists it, or it has
 * no project and is in Today. Seeded through the store; the delete and the
 * move use the real UI.
 */
const INBOX = 'INBOX_PROJECT';

interface NoteSnapshot {
  note?: { id: string; projectId: string | null; isPinnedToToday: boolean };
  listedInProjects: string[];
  inTodayOrder: boolean;
  projectIds: string[];
}

const snapshot = (page: Page, noteId: string): Promise<NoteSnapshot> =>
  page.evaluate((id) => {
    type State = {
      note: {
        entities: Record<
          string,
          { id: string; projectId: string | null; isPinnedToToday: boolean }
        >;
        todayOrder: string[];
      };
      projects: { ids: string[]; entities: Record<string, { noteIds: string[] }> };
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
    const n = state.note.entities[id];
    return {
      note: n && {
        id: n.id,
        projectId: n.projectId,
        isPinnedToToday: n.isPinnedToToday,
      },
      listedInProjects: state.projects.ids.filter((pid) =>
        state.projects.entities[pid].noteIds.includes(id),
      ),
      inTodayOrder: state.note.todayOrder.includes(id),
      projectIds: state.projects.ids,
    };
  }, noteId);

/** Invariant violations of one device's snapshot, as readable strings. */
const unreachable = (name: string, s: NoteSnapshot): string[] => {
  if (!s.note) {
    return s.listedInProjects.length || s.inTodayOrder
      ? [`${name}: deleted note still listed`]
      : [];
  }
  const { projectId } = s.note;
  if (projectId === null) {
    return s.inTodayOrder ? [] : [`${name}: project-less note not in Today`];
  }
  if (!s.projectIds.includes(projectId)) {
    return [
      `${name}: note points to missing project ${projectId}, listed in [${s.listedInProjects}]`,
    ];
  }
  return s.listedInProjects.includes(projectId)
    ? []
    : [`${name}: note not listed in its project ${projectId}`];
};

const seedNote = async (page: Page, id: string): Promise<void> => {
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );
  await page.evaluate(
    async ({ noteId, projectId }) => {
      (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers.store.dispatch({
        type: '[Note] Add Note',
        note: {
          id: noteId,
          projectId,
          isPinnedToToday: false,
          content: 'Synthetic note',
          created: 100,
          modified: 100,
        },
        isPreventFocus: true,
        meta: { isPersistent: true, entityType: 'NOTE', entityId: noteId, opType: 'CRT' },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    { noteId: id, projectId: INBOX },
  );
};

const projectIdByTitle = (page: Page, title: string): Promise<string | undefined> =>
  page.evaluate((t) => {
    type State = {
      projects: { ids: string[]; entities: Record<string, { title: string }> };
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
    return state.projects.ids.find((id) => state.projects.entities[id].title === t);
  }, title);

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
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (r) => r.url().includes('/api/sync/ops') && r.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await client.sync.conflictDialog.isVisible())
          ? 'conflict-dialog'
          : (await client.sync.hasSyncError())
            ? 'error'
            : !(await client.sync.syncSpinner.isVisible()) &&
                (await client.sync.syncCheckIcon
                  .filter({ hasText: /^done_all$/ })
                  .isVisible())
              ? 'in-sync'
              : 'pending',
      { timeout: 30000 },
    )
    .toBe('in-sync');
};

const blockAutoSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.addInitScript(() => {
    const flags = window as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });
};

const moveNoteToProject = async (
  client: SimulatedE2EClient,
  noteId: string,
  projectTitle: string,
): Promise<void> => {
  await client.page.goto(`/#/project/${INBOX}/tasks`);
  await client.workView.waitForTaskList();
  await new NotePage(client.page).ensureNotesVisible();
  const note = client.page.locator(`#n-${noteId}`);
  await note.hover();
  await note.locator('button:has(mat-icon:text-is("more_vert"))').click();
  await client.page
    .locator('.mat-mdc-menu-panel button')
    .filter({ has: client.page.locator('mat-icon:text-is("forward")') })
    .click();
  await client.page
    .locator('.mat-mdc-menu-panel button')
    .filter({ hasText: projectTitle })
    .click();
  await expect(client.page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

for (const deleterSyncsFirst of [true, false]) {
  test(`@supersync note moved into a concurrently deleted project stays reachable and converges / ${deleterSyncsFirst ? 'deleter' : 'mover'} syncs first`, async ({
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
      const noteId = `moved-${testRunId}`;
      const projectTitle = `Doomed-${testRunId}`;

      const deleter = await makeClient('Deleter');
      await createProjectReliably(deleter.page, projectTitle);
      const projectId = await projectIdByTitle(deleter.page, projectTitle);
      expect(projectId).toBeTruthy();
      await seedNote(deleter.page, noteId);
      await sync(deleter);
      const mover = await makeClient('Mover');
      await sync(mover);
      expect(await snapshot(mover.page, noteId)).toEqual(
        await snapshot(deleter.page, noteId),
      );

      // The crossing: both changes are made before either device syncs.
      await new ProjectPage(deleter.page).deleteProject(projectTitle);
      await expect.poll(() => pendingCount(deleter.page)).toBeGreaterThan(0);
      await moveNoteToProject(mover, noteId, projectTitle);
      await expect.poll(() => pendingCount(mover.page)).toBe(1);

      const [first, second] = deleterSyncsFirst ? [deleter, mover] : [mover, deleter];
      await sync(first);
      await sync(second);
      await sync(first);
      await sync(second);

      const check = async (): Promise<NoteSnapshot[]> => {
        const states = [
          await snapshot(deleter.page, noteId),
          await snapshot(mover.page, noteId),
        ];
        expect([
          ...unreachable('Deleter', states[0]),
          ...unreachable('Mover', states[1]),
        ]).toEqual([]);
        expect(states[1].note).toEqual(states[0].note);
        return states;
      };
      await check();
      for (const client of [deleter, mover]) {
        await client.page.reload();
        await waitForAppReady(client.page);
        await sync(client);
      }
      const [afterReload] = await check();
      const fresh = await makeClient('Fresh');
      await sync(fresh);
      const freshState = await snapshot(fresh.page, noteId);
      expect(unreachable('Fresh', freshState)).toEqual([]);
      expect(freshState.note).toEqual(afterReload.note);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
}
