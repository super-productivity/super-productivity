import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import {
  addPlainspaceProvider,
  FakePlainspace,
  installFakePlainspace,
  successfulPolls,
  waitForPollAfter,
} from '../../utils/plainspace-fake';
import { deleteTaskViaContextMenu } from '../../utils/recently-deleted-helpers';

// Release 1 of the multi-user collaboration plan
// (docs/plans/2026-10-21-multi-user-collaboration.md): per-field pull,
// poll-time push of offline edits, title both ways, visible per-task state.
// Plainspace has no E2E harness here, so the integration API is a stateful
// `page.route` fake (see plainspace-fake.ts).

const TASK_ID = 'task-1';

/**
 * Shares a project with one task assigned to me and waits until it is imported.
 * The stub stays installed across reloads, so a reload is a restart.
 */
const setUp = async (
  page: Page,
  projectPage: ProjectPage,
  title = 'Buy tent',
): Promise<FakePlainspace> => {
  const server = await installFakePlainspace(page);
  server.addAssignedTask(TASK_ID, title);
  await projectPage.createProject('Camping');
  await addPlainspaceProvider(page, /Camping/);
  await projectPage.navigateToProjectByName('Camping');
  await expect(taskRow(page, title)).toBeVisible({ timeout: 30000 });
  return server;
};

const taskRow = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/**
 * Renames a task in place (the row's text moves into a textarea meanwhile).
 * `shownTitle`: the title once short syntax in `newTitle` is applied.
 */
const renameTask = async (
  page: Page,
  title: string,
  newTitle: string,
  shownTitle = newTitle,
): Promise<void> => {
  const row = taskRow(page, title);
  const taskId = await row.getAttribute('data-task-id');
  await row.locator('task-title').click();
  const textarea = page.locator(`task[data-task-id="${taskId}"] textarea`).first();
  await expect(textarea).toBeVisible();
  await textarea.fill(newTitle);
  await page.keyboard.press('Tab');
  await expect(taskRow(page, shownTitle)).toBeVisible();
};

/** Opens the task's detail panel unless it is already open. */
const openDetail = async (page: Page, title: string): Promise<void> => {
  const panel = page.locator('task-detail-panel');
  if (!(await panel.isVisible())) {
    const row = taskRow(page, title);
    await row.hover();
    await row.getByRole('button', { name: 'Show/hide task panel' }).click();
  }
  await expect(panel).toBeVisible();
};

/**
 * Renames while offline and waits until the rename's own push has failed: its
 * read of the task gets no answer, so nothing is written. Going back online
 * earlier could let that push reach Plainspace after whatever the test sets up
 * next.
 */
const renameOffline = async (
  page: Page,
  server: FakePlainspace,
  title: string,
  newTitle: string,
): Promise<void> => {
  server.isOffline = true;
  await renameTask(page, title, newTitle);
  await waitForFailedPush(server);
};

/** Waits until a push's read of the task got no answer. */
const waitForFailedPush = async (server: FakePlainspace): Promise<void> => {
  const attempts = server.offlineRequests.length;
  await expect
    .poll(() => server.offlineRequests.slice(attempts), { timeout: 15000 })
    .toContain(`GET /tasks/${TASK_ID}`);
};

/** The title the task last agreed on with Plainspace (its sync baseline). */
const syncedTitle = (page: Page): Promise<unknown> =>
  page.evaluate((issueId) => {
    type TaskLike = { issueId?: string; issueLastSyncedValues?: { title?: unknown } };
    type StoreLike = {
      subscribe: (
        next: (state: { tasks: { entities: Record<string, TaskLike> } }) => void,
      ) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
      .__e2eTestHelpers.store;
    let task: TaskLike | undefined;
    store
      .subscribe((state) => {
        task = Object.values(state.tasks.entities).find((t) => t?.issueId === issueId);
      })
      .unsubscribe();
    return task?.issueLastSyncedValues?.title;
  }, TASK_ID);

/** The linked task's title and the fields short syntax would set. */
const localTask = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate((issueId) => {
    type TaskLike = Record<string, unknown> & { issueId?: string };
    type StoreLike = {
      subscribe: (
        next: (state: { tasks: { entities: Record<string, TaskLike> } }) => void,
      ) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
      .__e2eTestHelpers.store;
    let task: TaskLike | undefined;
    store
      .subscribe((state) => {
        task = Object.values(state.tasks.entities).find((t) => t?.issueId === issueId);
      })
      .unsubscribe();
    return {
      title: task?.title,
      tagIds: task?.tagIds,
      dueDay: task?.dueDay ?? null,
      dueWithTime: task?.dueWithTime ?? null,
      timeEstimate: task?.timeEstimate,
      projectId: task?.projectId,
    };
  }, TASK_ID);

/** Restarts the app; the update and import polls run 8 s after load. */
const restart = async (page: Page, server: FakePlainspace): Promise<void> => {
  const before = successfulPolls(server);
  await page.reload();
  await waitForPollAfter(page, server, before);
};

test.describe('Plainspace Release 1 sync', () => {
  test.setTimeout(180000);

  test('a remote change no longer overwrites an unrelated local rename; the offline rename is pushed on the next poll', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    // Renamed while Plainspace can't be reached: the push fails.
    await renameOffline(page, server, 'Buy tent', 'Buy a bigger tent');

    // Meanwhile someone ticks the task off in Plainspace.
    server.remoteEdit(TASK_ID, { done: true });
    server.isOffline = false;

    // Restart and poll: the remote completion lands, the local title stays,
    // and the title is pushed because Plainspace still has the old one.
    await restart(page, server);
    const row = taskRow(page, 'Buy a bigger tent');
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/isDone/);
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Buy a bigger tent');
    expect(server.tasks.get(TASK_ID)!.done).toBe(true);
  });

  test('an edit made offline is not pushed while polls fail, then once after a successful poll', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    // Offline: the rename's own push fails.
    server.isOffline = true;
    server.isTasksOffline = true;
    await renameTask(page, 'Buy tent', 'Buy a tent');
    await waitForFailedPush(server);
    // A push would now go through, but /tasks still fails: nothing is pushed
    // from a failed poll.
    server.isOffline = false;
    const failedBefore = server.taskListRequests.length;
    await page.reload();
    await expect
      .poll(() => server.taskListRequests.length, { timeout: 30000 })
      .toBeGreaterThanOrEqual(failedBefore + 2);
    // Deliberate: a push queued by a failed poll would show up meanwhile.
    await page.waitForTimeout(2000);
    expect(server.patches).toEqual([]);

    // Back online: the next successful poll pushes it, once.
    server.isTasksOffline = false;
    await restart(page, server);
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Buy a tent');
    await page.waitForTimeout(2000);
    expect(server.patches).toEqual([
      { id: TASK_ID, body: { title: 'Buy a tent' }, status: 200 },
    ]);
  });

  test('title round-trips both ways and is sent verbatim', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await renameTask(page, 'Buy tent', 'Buy tent  (2 people)');
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Buy tent  (2 people)');
    expect(server.patches.at(-1)).toEqual({
      id: TASK_ID,
      body: { title: 'Buy tent  (2 people)' },
      status: 200,
    });

    server.remoteEdit(TASK_ID, { title: 'Buy tent and pegs' });
    await restart(page, server);
    await expect(taskRow(page, 'Buy tent and pegs')).toBeVisible();
    // Pulling it is not an edit: nothing is pushed back. Deliberate: a push
    // queued after the pull would show up meanwhile.
    await page.waitForTimeout(2000);
    expect(server.patches.length).toBe(1);
  });

  test('a title edited with short syntax is sent once, cleaned', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await renameTask(
      page,
      'Buy tent',
      'Buy tent and pegs @tomorrow',
      'Buy tent and pegs',
    );
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Buy tent and pegs');
    // Deliberate: a second write would show up meanwhile.
    await page.waitForTimeout(2000);
    // The raw tokens never reach the space.
    expect(server.patches.map((p) => p.body)).toEqual([{ title: 'Buy tent and pegs' }]);
  });

  // A shared title holds text collaborators wrote. Editing it applies short
  // syntax only to words typed in this edit; the others stay plain text in
  // the shared title and change no tag, date or estimate.
  test('editing a shared title keeps the short syntax already in it as text', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const shared = 'Fix bug #123 #urgent for @fri 30m';
    const server = await setUp(page, projectPage, shared);
    const before = await localTask(page);

    await renameTask(page, shared, 'Fix bugs #123 #urgent for @fri 30m');
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Fix bugs #123 #urgent for @fri 30m');
    // Deliberate: a second write or a parse would land meanwhile.
    await page.waitForTimeout(2000);
    expect(server.patches.map((p) => p.body)).toEqual([
      { title: 'Fix bugs #123 #urgent for @fri 30m' },
    ]);
    expect(await localTask(page)).toEqual({
      ...before,
      title: 'Fix bugs #123 #urgent for @fri 30m',
    });
    await expect(page.locator('dialog-confirm')).toHaveCount(0);

    // Syntax typed in this edit still applies, and only it leaves the title.
    await renameTask(
      page,
      'Fix bugs #123 #urgent for @fri 30m',
      'Fix bugs #123 #urgent for @fri 30m 1h',
      'Fix bugs #123 #urgent for @fri 30m',
    );
    await expect.poll(async () => (await localTask(page)).timeEstimate).toBe(3600000);
    await page.waitForTimeout(2000);
    expect(server.patches.length).toBe(1);
    expect(await localTask(page)).toEqual({
      ...before,
      title: 'Fix bugs #123 #urgent for @fri 30m',
      timeEstimate: 3600000,
    });
  });

  // Found by the test above on the production build: a collaborator's rename
  // landing right after our PATCH was marked as seen by the engine's
  // re-fetch and never pulled. The marker now comes from the PATCH answer.
  test('a remote rename right after our push is still pulled', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    server.afterPatch = () => {
      server.afterPatch = null;
      server.remoteEdit(TASK_ID, { title: 'Buy tent and stakes' });
    };

    await renameTask(page, 'Buy tent', 'Buy a tent');
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Buy tent and stakes');
    // Let the push finish storing its baseline before the restart.
    await page.waitForTimeout(2000);

    await restart(page, server);
    await expect(taskRow(page, 'Buy tent and stakes')).toBeVisible();
  });

  // Review finding: the PATCH answer marks everything in it as seen, including
  // a collaborator's change that landed between our fetch and our write. It
  // was never pulled until some later remote change.
  test('a remote rename that lands just before our push is still pulled', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    server.beforePatch = () => {
      server.beforePatch = null;
      server.remoteEdit(TASK_ID, { title: 'Buy tent and stakes' });
    };

    await taskPage.markTaskAsDone(taskRow(page, 'Buy tent'));
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.done, { timeout: 15000 })
      .toBe(true);
    expect(server.tasks.get(TASK_ID)!.title).toBe('Buy tent and stakes');
    // Let the push finish storing its baseline before the restart.
    await page.waitForTimeout(2000);

    await restart(page, server);
    await expect(taskRow(page, 'Buy tent and stakes')).toBeVisible();
  });

  test('two devices pushing the same edit converge without a second write', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    // This device renames offline; another device already sent the same name.
    await renameOffline(page, server, 'Buy tent', 'Buy two tents');
    server.isOffline = false;
    server.remoteEdit(TASK_ID, { title: 'Buy two tents' });
    const patchesBefore = server.patches.length;

    await restart(page, server);
    await expect(taskRow(page, 'Buy two tents')).toBeVisible();
    // Converged: the baseline is the shared title, so nothing stays pending.
    await expect.poll(() => syncedTitle(page)).toBe('Buy two tents');
    // Give a queued push time to show up if there were one.
    await page.waitForTimeout(2000);
    expect(server.patches.slice(patchesBefore)).toEqual([]);
  });

  test('an older server keeps done syncing and says once that it is too old for titles', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    server.isOldServer = true;

    await renameTask(page, 'Buy tent', 'Buy a tent');
    await expect
      .poll(() => server.patches.map((p) => p.status), { timeout: 15000 })
      .toEqual([422]);
    // An expected limitation, not an error. Deliberate: an error snack would
    // show up meanwhile.
    await page.waitForTimeout(2000);
    await expect(
      page.locator('mat-snack-bar-container', { hasText: /push failed/i }),
    ).toHaveCount(0);

    await taskPage.markTaskAsDone(taskRow(page, 'Buy a tent'));
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.done, { timeout: 15000 })
      .toBe(true);
    // Titles are no longer sent to this server.
    expect(server.patches.slice(1).map((p) => p.body)).toEqual([{ done: true }]);
    expect(server.tasks.get(TASK_ID)!.title).toBe('Buy tent');

    await page.locator('.e2e-toggle-issue-provider-panel').click();
    const tooOld = page.locator('plainspace-reconnect-notice .callout', {
      hasText: 'too old to sync titles and times',
    });
    await expect(tooOld).toHaveCount(1);
    await expect(tooOld).toBeVisible();
  });

  test('offline never marks a task "no longer in your list"; a successful poll does', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    const notInList = page.locator('issue-sync-state .callout', {
      hasText: 'No longer in your Plainspace list',
    });

    // Offline polls say nothing about membership.
    server.isTasksOffline = true;
    const failedBefore = server.taskListRequests.length;
    await page.reload();
    await expect
      .poll(() => server.taskListRequests.length, { timeout: 30000 })
      .toBeGreaterThanOrEqual(failedBefore + 2);
    // A notice would open the issue section by itself.
    await openDetail(page, 'Buy tent');
    await expect(page.locator('issue-header')).toBeVisible();
    await expect(notInList).toHaveCount(0);

    // Reassigned in Plainspace: the next successful poll no longer lists it.
    server.isTasksOffline = false;
    server.assignedIds.delete(TASK_ID);
    await restart(page, server);
    await openDetail(page, 'Buy tent');
    await expect(notInList).toBeVisible();

    // The task stays and no longer pushes.
    await renameTask(page, 'Buy tent', 'Buy tent (mine)');
    await page.waitForTimeout(2000);
    expect(server.patches).toEqual([]);
  });

  // Review finding: the remote delete waits out the undo window, and a poll
  // inside it saw the item still assigned and the task gone, so it imported
  // it again. Then the delayed delete removed it for everyone and left the
  // new copy behind.
  test('a poll inside the undo window does not bring a deleted task back', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await deleteTaskViaContextMenu(page, 'Buy tent');
    // Coming back to the app polls at once.
    const before = successfulPolls(server);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(() => successfulPolls(server), { timeout: 15000 })
      .toBeGreaterThan(before);

    // The undo window ends: deleted for everyone, and here.
    await expect
      .poll(() => server.assignedIds.has(TASK_ID), { timeout: 15000 })
      .toBe(false);
    await page.waitForTimeout(1000);
    await expect(taskRow(page, 'Buy tent')).toHaveCount(0);
  });

  test('a failed push shows "couldn\'t sync" on the task and Retry pushes it', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    server.isPatchServerError = true;

    await renameTask(page, 'Buy tent', 'Buy a tent');
    // The existing failure snack stays.
    await expect(
      page.locator('mat-snack-bar-container', { hasText: /push failed/i }),
    ).toBeVisible();
    await openDetail(page, 'Buy a tent');
    const couldNotSync = page.locator('issue-sync-state .callout', {
      hasText: "Couldn't sync",
    });
    await expect(couldNotSync).toBeVisible();

    server.isPatchServerError = false;
    await couldNotSync.getByRole('button', { name: 'Retry' }).click();
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
      .toBe('Buy a tent');
    await expect(couldNotSync).toHaveCount(0);
  });
});
