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
 * #10744: one device deletes a project while another, before either syncs,
 * moves a note or a task into it. The moved item is kept and re-homed to the
 * Inbox: every device must show it there with its content, in both sync
 * orders, after a reload and on a device that joins later. The note is seeded
 * through the store; the task, the delete and the moves use the real UI.
 */
const INBOX = 'INBOX_PROJECT';
type Kind = 'note' | 'task';
const KINDS: Kind[] = ['note'];

interface ItemSnapshot {
  item?: { id: string; projectId: string | null; content: string };
  listedInProjects: string[];
  projectIds: string[];
}

const snapshot = (page: Page, kind: Kind, itemId: string): Promise<ItemSnapshot> =>
  page.evaluate(
    ({ id, isNote }) => {
      type State = {
        note: {
          entities: Record<
            string,
            { id: string; projectId: string | null; content: string }
          >;
        };
        tasks: {
          entities: Record<
            string,
            { id: string; projectId: string | null; title: string }
          >;
        };
        projects: {
          ids: string[];
          entities: Record<
            string,
            { noteIds: string[]; taskIds: string[]; backlogTaskIds: string[] }
          >;
        };
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
      const note = state.note.entities[id];
      const task = state.tasks.entities[id];
      const item = isNote
        ? note && { id: note.id, projectId: note.projectId, content: note.content }
        : task && { id: task.id, projectId: task.projectId, content: task.title };
      return {
        item,
        listedInProjects: state.projects.ids.filter((pid) => {
          const p = state.projects.entities[pid];
          return (isNote ? p.noteIds : [...p.taskIds, ...p.backlogTaskIds]).includes(id);
        }),
        projectIds: state.projects.ids,
      };
    },
    { id: itemId, isNote: kind === 'note' },
  );

const NOTE_CONTENT = 'Synthetic note';

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
          content: NOTE_CONTENT,
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

const taskIdByTitle = (page: Page, title: string): Promise<string | undefined> =>
  page.evaluate((t) => {
    type State = {
      tasks: { ids: string[]; entities: Record<string, { title: string }> };
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
    return state.tasks.ids.find((id) => state.tasks.entities[id].title === t);
  }, title);

const openInbox = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.goto(`/#/project/${INBOX}/tasks`);
  await client.workView.waitForTaskList();
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
  await openInbox(client);
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

const moveTaskToProject = async (
  client: SimulatedE2EClient,
  taskId: string,
  projectTitle: string,
): Promise<void> => {
  await openInbox(client);
  await client.page
    .locator(`task[data-task-id="${taskId}"] task-title`)
    .first()
    .click({ button: 'right' });
  await client.page
    .locator('.mat-mdc-menu-panel button[mat-menu-item]')
    .filter({ has: client.page.locator('mat-icon:text-is("forward")') })
    .click();
  await client.page
    .locator('.mat-mdc-menu-panel')
    .last()
    .locator('button[mat-menu-item]')
    .filter({ hasText: projectTitle })
    .click();
  await expect(client.page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

/** The item as a user finds it: listed on the Inbox page. */
const expectVisibleInInbox = async (
  client: SimulatedE2EClient,
  kind: Kind,
  itemId: string,
): Promise<void> => {
  await openInbox(client);
  if (kind === 'note') await new NotePage(client.page).ensureNotesVisible();
  await expect(
    client.page.locator(
      kind === 'note' ? `#n-${itemId}` : `task[data-task-id="${itemId}"]`,
    ),
  ).toBeVisible();
};

for (const kind of KINDS) {
  for (const deleterSyncsFirst of [true, false]) {
    test(`@supersync ${kind} moved into a concurrently deleted project is kept in the Inbox on every device / ${deleterSyncsFirst ? 'deleter' : 'mover'} syncs first`, async ({
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
        const projectTitle = `Doomed-${testRunId}`;
        const content = kind === 'note' ? NOTE_CONTENT : `Moved-${testRunId}`;

        const deleter = await makeClient('Deleter');
        await createProjectReliably(deleter.page, projectTitle);
        const doomedId = await projectIdByTitle(deleter.page, projectTitle);
        expect(doomedId).toBeTruthy();
        let itemId = `moved-${testRunId}`;
        if (kind === 'note') {
          await seedNote(deleter.page, itemId);
        } else {
          await openInbox(deleter);
          await deleter.workView.addTask(content);
          await expect.poll(() => taskIdByTitle(deleter.page, content)).toBeTruthy();
          itemId = (await taskIdByTitle(deleter.page, content))!;
        }
        await sync(deleter);
        const mover = await makeClient('Mover');
        await sync(mover);
        expect(await snapshot(mover.page, kind, itemId)).toEqual(
          await snapshot(deleter.page, kind, itemId),
        );

        // The crossing: both changes are made before either device syncs.
        await new ProjectPage(deleter.page).deleteProject(projectTitle);
        await expect.poll(() => pendingCount(deleter.page)).toBeGreaterThan(0);
        await (kind === 'note' ? moveNoteToProject : moveTaskToProject)(
          mover,
          itemId,
          projectTitle,
        );
        await expect.poll(() => pendingCount(mover.page)).toBeGreaterThan(0);

        const [first, second] = deleterSyncsFirst ? [deleter, mover] : [mover, deleter];
        await sync(first);
        await sync(second);
        await sync(first);
        await sync(second);

        // Kept, re-homed to the Inbox and listed there, content intact.
        const expected: ItemSnapshot = {
          item: { id: itemId, projectId: INBOX, content },
          listedInProjects: [INBOX],
          projectIds: (await snapshot(deleter.page, kind, itemId)).projectIds,
        };
        expect(expected.projectIds).toContain(INBOX);
        expect(expected.projectIds).not.toContain(doomedId);
        const check = async (): Promise<void> => {
          expect({
            Deleter: await snapshot(deleter.page, kind, itemId),
            Mover: await snapshot(mover.page, kind, itemId),
          }).toEqual({ Deleter: expected, Mover: expected });
          await expectVisibleInInbox(deleter, kind, itemId);
          await expectVisibleInInbox(mover, kind, itemId);
        };
        await check();
        for (const client of [deleter, mover]) {
          await client.page.reload();
          await waitForAppReady(client.page);
          await sync(client);
        }
        await check();
        const fresh = await makeClient('Fresh');
        await sync(fresh);
        expect(await snapshot(fresh.page, kind, itemId)).toEqual(expected);
        await expectVisibleInInbox(fresh, kind, itemId);
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
}
