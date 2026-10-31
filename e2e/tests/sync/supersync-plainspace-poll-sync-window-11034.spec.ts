import { Page, Route } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  routeSuperSyncOps,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ProjectPage } from '../../pages/project.page';
import {
  FakePlainspace,
  installFakePlainspace,
  PLAINSPACE_HOST,
  PLAINSPACE_SPACE,
} from '../../utils/plainspace-fake';

/**
 * #11034 — the issue-provider update poll has no skipDuringSyncWindow(), and
 * Plainspace also polls on focus. Two SP devices on SuperSync share one
 * Plainspace space (one stateful fake, real `SPTask` shapes) and one linked
 * task.
 *
 * - "gap 2": B's focus poll is in flight while B syncs A's newer ops; its
 *   stale answer lands in the post-sync cooldown. Both devices show the old
 *   title until the next poll restores the rename; nothing wrong is pushed.
 *   A regression guard: no lasting harm from the sync window.
 * - "stale title": B pulls a collaborator's title before it has A's ops,
 *   between A's offline rename and A's later push. The push used to write
 *   only the baseline, so field-level LWW kept B's title with A's baseline and
 *   the next poll pushed the stale title back: the rename was lost everywhere.
 *   The window is not the cause (the focus case polls outside any sync
 *   window); the baseline write now carries the pushed title.
 */

const TASK_ID = 'task-1';
const T0 = 'Buy tent';
const T1 = 'Buy big tent';
const MINE = 'Buy the green tent';

/** `e2e-allow-auto-sync` in sessionStorage lets one startup run its initial sync. */
const blockBackgroundSync = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] =
    sessionStorage.getItem('e2e-allow-auto-sync') !== '1';
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

/**
 * addPlainspaceProvider() for a SuperSync client: its Advanced Config section
 * can already be open, so it is only expanded when the project select is hidden.
 */
const addPlainspaceProvider = async (page: Page, projectName: RegExp): Promise<void> => {
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await expect(page.locator('issue-panel')).toBeVisible();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'Plainspace', exact: true }).click();
  const editDialog = page.locator('dialog-edit-issue-provider');
  await editDialog.locator('input[id*="host"]').fill(PLAINSPACE_HOST);
  await editDialog.locator('input[id*="spaceId"]').fill(PLAINSPACE_SPACE.id);
  await editDialog.locator('input[id*="token"]').fill('pat_e2e');
  const projectSelect = editDialog.locator('mat-select[id*="defaultProjectId"]');
  if (!(await projectSelect.isVisible())) {
    await editDialog.getByRole('button', { name: /Advanced Config/i }).click();
  }
  await projectSelect.click();
  await page.getByRole('option', { name: projectName }).click();
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editDialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
};

interface LinkedTask {
  id: string;
  title: string;
  baselineTitle: unknown;
  isDone: boolean;
  doneOn: number | undefined;
  baselineDone: unknown;
  issueLastUpdated: unknown;
}

/** The task linked to Plainspace's TASK_ID, read from the live store. */
const readLinkedTask = (page: Page): Promise<LinkedTask | null> =>
  page.evaluate(async (issueId) => {
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      return null;
    }
    interface TaskLike {
      id: string;
      title: string;
      issueId?: string;
      isDone: boolean;
      doneOn?: number;
      issueLastSyncedValues?: { title?: unknown; isDone?: unknown };
      issueLastUpdated?: unknown;
    }
    type TaskSlice = { entities?: Record<string, TaskLike | undefined> };
    const state = await new Promise<{ tasks?: TaskSlice; task?: TaskSlice }>(
      (resolve) => {
        const sub = store.subscribe((s) => {
          resolve(s as { tasks?: TaskSlice; task?: TaskSlice });
          setTimeout(() => sub.unsubscribe());
        });
      },
    );
    const entities = (state.tasks ?? state.task)?.entities ?? {};
    const task = Object.values(entities).find((t) => t?.issueId === issueId);
    return task
      ? {
          id: task.id,
          title: task.title,
          baselineTitle: task.issueLastSyncedValues?.title,
          isDone: task.isDone,
          doneOn: task.doneOn,
          baselineDone: task.issueLastSyncedValues?.isDone,
          issueLastUpdated: task.issueLastUpdated,
        }
      : null;
  }, TASK_ID);

/** Update polls (`refreshIssueTasks`) the page started, from its own log. */
const trackUpdatePolls = (page: Page): (() => number) => {
  let count = 0;
  page.on('console', (msg) => {
    if (msg.text().includes('POLLING CHANGES FOR PLAINSPACE')) {
      count++;
    }
  });
  return () => count;
};

const renameTask = async (page: Page, title: string, newTitle: string): Promise<void> => {
  const row = page.locator('task').filter({ hasText: title }).first();
  const taskId = await row.getAttribute('data-task-id');
  await row.locator('task-title').click();
  const textarea = page.locator(`task[data-task-id="${taskId}"] textarea`).first();
  await expect(textarea).toBeVisible();
  await textarea.fill(newTitle);
  await page.keyboard.press('Tab');
  await expect(page.locator('task').filter({ hasText: newTitle })).toBeVisible();
};

/**
 * Holds every `/tasks` GET of the page, answering it on release with the
 * fake's state from the moment the request arrived: a read that reached
 * Plainspace before what the test does next, but whose answer lands after.
 */
const holdTaskListReads = async (
  page: Page,
  server: FakePlainspace,
): Promise<{ held: () => number; release: () => void }> => {
  let held = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let isReleased = false;
  await page.route(
    /^https:\/\/plainspace\.org\/api\/integration\/tasks(\?|$)/,
    async (route: Route) => {
      if (route.request().method() !== 'GET' || isReleased) {
        await route.fallback();
        return;
      }
      const snapshot = {
        tasks: [...server.assignedIds].map((id) => ({ ...server.tasks.get(id)! })),
      };
      held++;
      await gate;
      server.taskListRequests.push({ status: 200 });
      await route.fulfill({
        status: 200,
        headers: { ['access-control-allow-origin']: '*' },
        json: snapshot,
      });
    },
  );
  return {
    held: () => held,
    release: () => {
      isReleased = true;
      release();
    },
  };
};

/**
 * Lets only this page's PATCHes go unanswered: the fake is shared, and its
 * `isOffline` would take the other device offline too.
 */
const routePatchOffline = async (
  page: Page,
): Promise<{ setOffline: (isOffline: boolean) => void; dropped: () => number }> => {
  let isOffline = false;
  let dropped = 0;
  await page.route(
    /^https:\/\/plainspace\.org\/api\/integration\/tasks\/[^/?]+(\?|$)/,
    async (route: Route) => {
      if (isOffline && route.request().method() === 'PATCH') {
        dropped++;
        await route.abort('internetdisconnected');
        return;
      }
      await route.fallback();
    },
  );
  return {
    setOffline: (value) => (isOffline = value),
    dropped: () => dropped,
  };
};

interface Client {
  c: SimulatedE2EClient;
  /** Update polls started (`refreshIssueTasks`). */
  updatePolls: () => number;
}

interface Setup {
  a: Client;
  b: Client;
  server: FakePlainspace;
}

/**
 * Starts the update poll the way an open app does: the Plainspace update poll
 * starts on the first local context switch or `loadAllData` after a load, and
 * a reload that hydrates by op replay into the same context dispatches
 * neither. Leaves the device in the Camping project after its first update
 * poll (8 s after the switch) settled.
 */
const switchContextAndAwaitUpdatePoll = async (client: Client): Promise<void> => {
  const before = client.updatePolls();
  const page = client.c.page;
  await page.goto('/#/tag/TODAY/work');
  await client.c.workView.waitForTaskList();
  await new ProjectPage(page).navigateToProjectByName('Camping');
  await expect.poll(client.updatePolls, { timeout: 30000 }).toBeGreaterThan(before);
  // Deliberate: the app applies the poll's result after the response arrives.
  await page.waitForTimeout(2000);
};

/** A restart: reload, then the first update poll (see above). */
const restart = async (client: Client): Promise<void> => {
  await client.c.page.reload();
  await switchContextAndAwaitUpdatePoll(client);
};

/** The refresh-on-look trigger: a window focus (throttled once a minute). */
const focusUpdatePoll = async (client: Client): Promise<void> => {
  const before = client.updatePolls();
  await client.c.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(client.updatePolls, { timeout: 15000 }).toBeGreaterThan(before);
  await client.c.page.waitForTimeout(2000);
};

const newClient = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  baseURL: string,
  name: string,
  testRunId: string,
): Promise<Client> => {
  const c = await createSimulatedClient(browser, baseURL, name, testRunId);
  return { c, updatePolls: trackUpdatePolls(c.page) };
};

/**
 * A shares the project with one Plainspace task, both devices sync, and both
 * hold the linked task with title and baseline T0 and have polled once.
 * Background sync is blocked (also across reloads), so only `syncAndWait`
 * moves ops.
 */
const setUp = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  baseURL: string,
  testRunId: string,
): Promise<Setup> => {
  const user = await createTestUser(testRunId);
  const syncConfig = getSuperSyncConfig(user);
  const a = await newClient(browser, baseURL, 'A', testRunId);
  const server = await installFakePlainspace(a.c.page);
  server.addAssignedTask(TASK_ID, T0);
  await a.c.sync.setupSuperSync(syncConfig);
  await a.c.page.addInitScript(blockBackgroundSync);
  await a.c.page.evaluate(blockBackgroundSync);

  await new ProjectPage(a.c.page).createProject('Camping');
  // Opened outside the project, the setup dialog asks for the default project.
  await a.c.page.goto('/#/tag/TODAY/work');
  await a.c.workView.waitForTaskList();
  await addPlainspaceProvider(a.c.page, /Camping/);
  // The import poll creates the task; A's first update poll may run before it.
  await new ProjectPage(a.c.page).navigateToProjectByName('Camping');
  await expect(a.c.page.locator('task').filter({ hasText: T0 })).toBeVisible({
    timeout: 30000,
  });
  await a.c.sync.syncAndWait();

  const b = await newClient(browser, baseURL, 'B', testRunId);
  await installFakePlainspace(b.c.page, server);
  await b.c.sync.setupSuperSync(syncConfig);
  await b.c.page.addInitScript(blockBackgroundSync);
  await b.c.page.evaluate(blockBackgroundSync);
  await expect
    .poll(async () => (await readLinkedTask(b.c.page))?.baselineTitle, {
      timeout: 30000,
    })
    .toBe(T0);
  await switchContextAndAwaitUpdatePoll(b);
  await b.c.sync.syncAndWait();
  await a.c.sync.syncAndWait();
  expect(server.patches).toEqual([]);
  return { a, b, server };
};

/** Logs and returns both devices' view of the task and Plainspace's. */
const snapshot = async (label: string, s: Setup): Promise<void> => {
  const ta = await readLinkedTask(s.a.c.page);
  const tb = await readLinkedTask(s.b.c.page);
  console.log(
    `[11034] ${label}: A=${JSON.stringify(ta)} B=${JSON.stringify(tb)} ` +
      `plainspace=${JSON.stringify(s.server.tasks.get(TASK_ID)!.title)} ` +
      `patches=${JSON.stringify(s.server.patches)}`,
  );
};

/** `done` values of the PATCHes Plainspace answered with 200, in order. */
const donePatches = (server: FakePlainspace): unknown[] =>
  server.patches
    .filter((p) => p.status === 200 && p.body['done'] !== undefined)
    .map((p) => p.body['done']);

/** Ticks the task's done toggle and waits until the store shows `isDone`. */
const toggleDone = async (page: Page, title: string, isDone: boolean): Promise<void> => {
  const row = page.locator('task').filter({ hasText: title }).first();
  await row.hover();
  await row.locator('done-toggle').click();
  await expect.poll(async () => (await readLinkedTask(page))?.isDone).toBe(isDone);
};

/** Title PATCHes Plainspace answered with 200, in order. */
const titlePatches = (server: FakePlainspace): unknown[] =>
  server.patches
    .filter((p) => p.status === 200 && p.body['title'] !== undefined)
    .map((p) => p.body['title']);

test.describe('@supersync Plainspace poll vs the sync window (#11034)', () => {
  test.setTimeout(300000);

  test('gap 2: a focus poll whose answer lands after B applied remote ops', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let s: Setup | null = null;
    try {
      s = await setUp(browser, baseURL!, testRunId);
      const { a, b, server } = s;

      // A collaborator renames the task in Plainspace.
      server.remoteEdit(TASK_ID, { title: T1 });

      // B looks at the app: its update poll reads Plainspace (T1), but the
      // answer is still in flight.
      const gate = await holdTaskListReads(b.c.page, server);
      const updatePollsBefore = b.updatePolls();
      await b.c.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(gate.held, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
      await expect.poll(b.updatePolls).toBe(updatePollsBefore + 1);

      // Meanwhile A pulls T1, the user renames it, the rename is pushed.
      await focusUpdatePoll(a);
      await expect(a.c.page.locator('task').filter({ hasText: T1 })).toBeVisible();
      await renameTask(a.c.page, T1, MINE);
      await expect
        .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
        .toBe(MINE);
      await expect
        .poll(async () => (await readLinkedTask(a.c.page))?.baselineTitle, {
          timeout: 15000,
        })
        .toBe(MINE);
      await a.c.sync.syncAndWait();

      // B syncs A's ops; the poll answer lands right after the apply, inside
      // the post-sync cooldown.
      await b.c.sync.syncAndWait();
      expect((await readLinkedTask(b.c.page))?.title).toBe(MINE);
      gate.release();
      await b.c.page.waitForTimeout(3000);
      await snapshot('after B stale poll landed', s);

      await b.c.sync.syncAndWait();
      await a.c.sync.syncAndWait();
      await snapshot('after both synced', s);

      // The next poll on each device.
      await restart(b);
      await restart(a);
      await b.c.sync.syncAndWait();
      await a.c.sync.syncAndWait();
      await b.c.sync.syncAndWait();
      await snapshot('after next polls and sync', s);

      // Plainspace keeps the rename, no stale title is pushed, both devices
      // end on the rename.
      expect(server.tasks.get(TASK_ID)!.title).toBe(MINE);
      expect(titlePatches(server)).toEqual([MINE]);
      expect((await readLinkedTask(a.c.page))?.title).toBe(MINE);
      expect((await readLinkedTask(b.c.page))?.title).toBe(MINE);
    } finally {
      if (s) {
        await closeClient(s.a.c);
        await closeClient(s.b.c);
      }
    }
  });

  // `firstToSync`: whose concurrent ops reach the server first, so the other
  // device resolves the conflict. 'A': B resolves; 'B': A resolves.
  const staleTitleCases = [
    { bPoll: 'startup', firstToSync: 'A' },
    { bPoll: 'focus', firstToSync: 'A' },
    { bPoll: 'focus', firstToSync: 'B' },
  ] as const;
  for (const { bPoll, firstToSync } of staleTitleCases) {
    test(`B pulls a stale title between A's offline rename and its push (B poll: ${bPoll}, first to sync: ${firstToSync})`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      let s: Setup | null = null;
      try {
        s = await setUp(browser, baseURL!, testRunId);
        const { a, b, server } = s;

        // A collaborator renames the task; A pulls it, B doesn't yet.
        server.remoteEdit(TASK_ID, { title: T1 });
        await focusUpdatePoll(a);
        await expect(a.c.page.locator('task').filter({ hasText: T1 })).toBeVisible();

        // The user renames on A while A can't reach Plainspace: the push fails.
        const patchA = await routePatchOffline(a.c.page);
        patchA.setOffline(true);
        await renameTask(a.c.page, T1, MINE);
        await expect.poll(patchA.dropped, { timeout: 15000 }).toBe(1);
        await a.c.sync.syncAndWait();

        // B polls before it has A's ops, and pulls T1.
        let releaseDownload: (() => void) | null = null;
        if (bPoll === 'startup') {
          // B restarts; its initial sync runs, but the download is held past
          // the 8 s poll delay, so the startup poll lands first.
          const downloadGate = new Promise<void>((r) => (releaseDownload = r));
          let heldDownloads = 0;
          await routeSuperSyncOps(b.c.page, async (route) => {
            if (route.request().method() === 'GET') {
              heldDownloads++;
              await downloadGate;
            }
            await route.fallback();
          });
          await b.c.page.evaluate(() =>
            sessionStorage.setItem('e2e-allow-auto-sync', '1'),
          );
          await restart(b);
          console.log(`[11034] B startup: held initial-sync downloads=${heldDownloads}`);
          expect(heldDownloads).toBeGreaterThanOrEqual(1);
        } else {
          await focusUpdatePoll(b);
        }
        await snapshot('B pulled', s);
        expect((await readLinkedTask(b.c.page))?.title).toBe(T1);

        // A gets back online; its next poll pushes the rename.
        patchA.setOffline(false);
        await restart(a);
        await expect
          .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
          .toBe(MINE);
        await expect
          .poll(async () => (await readLinkedTask(a.c.page))?.baselineTitle, {
            timeout: 15000,
          })
          .toBe(MINE);
        if (firstToSync === 'B') {
          await b.c.sync.syncAndWait();
        }
        await a.c.sync.syncAndWait();

        if (releaseDownload) {
          (releaseDownload as () => void)();
          await b.c.page.waitForTimeout(5000);
          await b.c.page.unroute('**/api/sync/ops*');
          await b.c.page.evaluate(() => {
            sessionStorage.removeItem('e2e-allow-auto-sync');
            (globalThis as Record<string, unknown>)['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
          });
        }

        await b.c.sync.syncAndWait();
        await a.c.sync.syncAndWait();
        await snapshot('after both synced', s);

        // The next poll on each device.
        await restart(b);
        await restart(a);
        await b.c.sync.syncAndWait();
        await a.c.sync.syncAndWait();
        await b.c.sync.syncAndWait();
        await snapshot('after next polls and sync', s);

        expect(server.tasks.get(TASK_ID)!.title).toBe(MINE);
        expect(titlePatches(server)).toEqual([MINE]);
        expect((await readLinkedTask(a.c.page))?.title).toBe(MINE);
        expect((await readLinkedTask(b.c.page))?.title).toBe(MINE);
      } finally {
        if (s) {
          await closeClient(s.a.c);
          await closeClient(s.b.c);
        }
      }
    });
  }

  // The same split for `isDone`: a collaborator flips it, A pulls that, the
  // user flips it back on A while A's pushes fail, B pulls the collaborator's
  // value before it has A's ops, then A's push lands. 'reopen': the user's
  // reopen of a task completed in Plainspace; 'completion': the user's
  // completion of a task reopened in Plainspace.
  const staleDoneCases = [
    { lost: 'reopen', firstToSync: 'A' },
    { lost: 'completion', firstToSync: 'A' },
    { lost: 'reopen', firstToSync: 'B' },
  ] as const;
  for (const { lost, firstToSync } of staleDoneCases) {
    test(`B pulls a stale done between A's offline ${lost} and its push (first to sync: ${firstToSync})`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      let s: Setup | null = null;
      try {
        s = await setUp(browser, baseURL!, testRunId);
        const { a, b, server } = s;
        const usersDone = lost === 'completion';

        if (lost === 'completion') {
          // Start from a task done everywhere.
          server.remoteEdit(TASK_ID, { done: true });
          await restart(a);
          await a.c.sync.syncAndWait();
          await b.c.sync.syncAndWait();
          await expect
            .poll(async () => (await readLinkedTask(b.c.page))?.baselineDone)
            .toBe(true);
        }

        // A collaborator flips done; A pulls it, B doesn't yet.
        server.remoteEdit(TASK_ID, { done: !usersDone });
        await focusUpdatePoll(a);
        expect((await readLinkedTask(a.c.page))?.isDone).toBe(!usersDone);

        // The user flips it back on A while A can't reach Plainspace.
        const patchA = await routePatchOffline(a.c.page);
        patchA.setOffline(true);
        await toggleDone(a.c.page, T0, usersDone);
        await expect.poll(patchA.dropped, { timeout: 15000 }).toBe(1);
        await a.c.sync.syncAndWait();

        // B polls before it has A's ops, and pulls the collaborator's value.
        await focusUpdatePoll(b);
        await snapshot('B pulled', s);
        expect((await readLinkedTask(b.c.page))?.isDone).toBe(!usersDone);

        // A gets back online; its next poll pushes the user's value.
        patchA.setOffline(false);
        await restart(a);
        await expect
          .poll(() => server.tasks.get(TASK_ID)!.done, { timeout: 15000 })
          .toBe(usersDone);
        await expect
          .poll(async () => (await readLinkedTask(a.c.page))?.baselineDone, {
            timeout: 15000,
          })
          .toBe(usersDone);
        if (firstToSync === 'B') {
          await b.c.sync.syncAndWait();
        }
        await a.c.sync.syncAndWait();
        await b.c.sync.syncAndWait();
        await a.c.sync.syncAndWait();
        await snapshot('after both synced', s);

        // The next poll on each device.
        await restart(b);
        await restart(a);
        await b.c.sync.syncAndWait();
        await a.c.sync.syncAndWait();
        await b.c.sync.syncAndWait();
        await snapshot('after next polls and sync', s);

        expect(server.tasks.get(TASK_ID)!.done).toBe(usersDone);
        expect(donePatches(server)).toEqual([usersDone]);
        expect((await readLinkedTask(a.c.page))?.isDone).toBe(usersDone);
        expect((await readLinkedTask(b.c.page))?.isDone).toBe(usersDone);
        // The completion date travels with the done state: cleared on a reopen,
        // kept on a completion, on both devices.
        for (const page of [a.c.page, b.c.page]) {
          const doneOn = (await readLinkedTask(page))?.doneOn;
          if (usersDone) {
            expect(typeof doneOn).toBe('number');
          } else {
            expect(doneOn).toBeUndefined();
          }
        }
      } finally {
        if (s) {
          await closeClient(s.a.c);
          await closeClient(s.b.c);
        }
      }
    });
  }

  // Both devices rename while neither reaches Plainspace; B's rename is the
  // newer one and syncs first. A's push then lands first, and the baseline
  // write re-stamps A's title after B's rename. Provider wins: the rename
  // that reached Plainspace first is kept, on every device and in Plainspace.
  test("A's older rename reaches Plainspace before B's newer one", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const THEIRS = 'Buy the blue tent';
    let s: Setup | null = null;
    try {
      s = await setUp(browser, baseURL!, testRunId);
      const { a, b, server } = s;

      const patchA = await routePatchOffline(a.c.page);
      patchA.setOffline(true);
      await renameTask(a.c.page, T0, MINE);
      await expect.poll(patchA.dropped, { timeout: 15000 }).toBe(1);

      const patchB = await routePatchOffline(b.c.page);
      patchB.setOffline(true);
      await renameTask(b.c.page, T0, THEIRS);
      await expect.poll(patchB.dropped, { timeout: 15000 }).toBe(1);
      await b.c.sync.syncAndWait();

      // A gets back online before it has B's rename; its poll pushes MINE.
      patchA.setOffline(false);
      await restart(a);
      await expect
        .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
        .toBe(MINE);
      await a.c.sync.syncAndWait();
      patchB.setOffline(false);
      await b.c.sync.syncAndWait();
      await a.c.sync.syncAndWait();
      await snapshot('after both synced', s);

      await restart(b);
      await restart(a);
      await b.c.sync.syncAndWait();
      await a.c.sync.syncAndWait();
      await b.c.sync.syncAndWait();
      await snapshot('after next polls and sync', s);

      expect(server.tasks.get(TASK_ID)!.title).toBe(MINE);
      expect(titlePatches(server)).toEqual([MINE]);
      expect((await readLinkedTask(a.c.page))?.title).toBe(MINE);
      expect((await readLinkedTask(b.c.page))?.title).toBe(MINE);
    } finally {
      if (s) {
        await closeClient(s.a.c);
        await closeClient(s.b.c);
      }
    }
  });
});
