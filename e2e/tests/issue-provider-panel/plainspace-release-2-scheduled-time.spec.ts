import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import {
  addPlainspaceProvider,
  FakePlainspace,
  FakeSpTask,
  installFakePlainspace,
  successfulPolls,
  waitForPollAfter,
} from '../../utils/plainspace-fake';

// Release 2 of the multi-user collaboration plan
// (docs/plans/2026-10-21-multi-user-collaboration.md § Scheduled time): the
// task's schedule syncs both ways as Plainspace's `scheduledAt`. A plan without
// a time sends "no time"; a repeating item's time is set in Plainspace only.
// Plainspace has no E2E harness here, so the integration API is a stateful
// `page.route` fake (see plainspace-fake.ts).

const TASK_ID = 'task-1';
const REMOTE_TIME = '2026-11-03T14:30:00.000Z';

/**
 * Shares a project with one task assigned to me, as Plainspace has it, and
 * waits until it is imported. A reload is a restart.
 */
const setUp = async (
  page: Page,
  projectPage: ProjectPage,
  remote: Partial<FakeSpTask> = {},
): Promise<FakePlainspace> => {
  const server = await installFakePlainspace(page);
  const task = server.addAssignedTask(TASK_ID, 'Buy tent');
  server.tasks.set(TASK_ID, { ...task, ...remote });
  await projectPage.createProject('Camping');
  await addPlainspaceProvider(page, /Camping/);
  await projectPage.navigateToProjectByName('Camping');
  await expect(taskRow(page, 'Buy tent')).toBeVisible({ timeout: 30000 });
  return server;
};

const taskRow = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/** Edits the title inline; short syntax in it is applied as when typing. */
const editTitle = async (page: Page, title: string, newTitle: string): Promise<void> => {
  const row = taskRow(page, title);
  const taskId = await row.getAttribute('data-task-id');
  await row.locator('task-title').click();
  const textarea = page.locator(`task[data-task-id="${taskId}"] textarea`).first();
  await expect(textarea).toBeVisible();
  await textarea.fill(newTitle);
  await page.keyboard.press('Tab');
};

/** The task's schedule as the store has it. */
const schedule = (
  page: Page,
): Promise<{ dueWithTime: number | null; dueDay: string | null }> =>
  page.evaluate((issueId) => {
    type TaskLike = { issueId?: string; dueWithTime?: number; dueDay?: string };
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
    return { dueWithTime: task?.dueWithTime ?? null, dueDay: task?.dueDay ?? null };
  }, TASK_ID);

/** Tomorrow at 10:00 on the app's clock, as an ISO instant. */
const tomorrowAtTen = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  });

const restart = async (page: Page, server: FakePlainspace): Promise<void> => {
  const before = successfulPolls(server);
  await page.reload();
  await waitForPollAfter(page, server, before);
};

test.describe('Plainspace Release 2: scheduled time', () => {
  test.setTimeout(180000);

  test('a time set in SP is sent; a time changed in Plainspace is pulled', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await editTitle(page, 'Buy tent', 'Buy tent @tomorrow 10:00');
    const sent = await tomorrowAtTen(page);
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.scheduledAt, { timeout: 15000 })
      .toBe(sent);
    // Only the time changed: the cleaned title equals the shared one.
    expect(server.patches.map((p) => p.body)).toEqual([{ scheduledAt: sent }]);
    await expect
      .poll(async () => (await schedule(page)).dueWithTime)
      .toBe(Date.parse(sent));

    server.remoteEdit(TASK_ID, { scheduledAt: REMOTE_TIME });
    await restart(page, server);
    await expect
      .poll(async () => (await schedule(page)).dueWithTime)
      .toBe(Date.parse(REMOTE_TIME));
    // Pulling is not pushing it back.
    expect(server.patches).toHaveLength(1);
  });

  test('a plan without a time sends "no time"', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage, { scheduledAt: REMOTE_TIME });
    await expect
      .poll(async () => (await schedule(page)).dueWithTime)
      .toBe(Date.parse(REMOTE_TIME));

    await editTitle(page, 'Buy tent', 'Buy tent @tomorrow');
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.scheduledAt, { timeout: 15000 })
      .toBeNull();
    expect(server.patches.map((p) => p.body)).toEqual([{ scheduledAt: null }]);
    const local = await schedule(page);
    expect(local.dueWithTime).toBeNull();
    expect(local.dueDay).not.toBeNull();
  });

  test('a repeating item: its time is not sent, and the next occurrence is pulled', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage, {
      scheduledAt: REMOTE_TIME,
      isRecurring: true,
    });
    await expect
      .poll(async () => (await schedule(page)).dueWithTime)
      .toBe(Date.parse(REMOTE_TIME));

    await editTitle(page, 'Buy tent', 'Buy tent @tomorrow 10:00');
    const local = Date.parse(await tomorrowAtTen(page));
    await expect.poll(async () => (await schedule(page)).dueWithTime).toBe(local);
    // Deliberate: a push would show up meanwhile.
    await page.waitForTimeout(2000);
    expect(server.patches).toEqual([]);

    // The local time stays while Plainspace's is unchanged...
    await restart(page, server);
    expect((await schedule(page)).dueWithTime).toBe(local);
    expect(server.patches).toEqual([]);

    // ...until the next occurrence moves it.
    const next = '2026-11-04T14:30:00.000Z';
    server.remoteEdit(TASK_ID, { scheduledAt: next });
    await restart(page, server);
    await expect
      .poll(async () => (await schedule(page)).dueWithTime)
      .toBe(Date.parse(next));
    expect(server.patches).toEqual([]);
  });

  test('a refused change shows "couldn\'t sync" on the task', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage, { scheduledAt: REMOTE_TIME });
    // Someone makes it repeat in Plainspace right before our write lands.
    server.beforePatch = () => {
      server.beforePatch = null;
      server.remoteEdit(TASK_ID, { isRecurring: true });
    };

    await editTitle(page, 'Buy tent', 'Buy tent @tomorrow');
    await expect
      .poll(() => server.patches.map((p) => p.status), { timeout: 15000 })
      .toEqual([409]);
    await taskRow(page, 'Buy tent').hover();
    await taskRow(page, 'Buy tent')
      .getByRole('button', { name: 'Show/hide task panel' })
      .click();
    await expect(
      page.locator('issue-sync-state .callout', {
        hasText: 'A repeating task needs its time in Plainspace',
      }),
    ).toBeVisible();
    // A state conflict, not an old server: the provider shows no notice.
    await page.locator('.e2e-toggle-issue-provider-panel').click();
    await expect(
      page.locator('plainspace-reconnect-notice .callout', { hasText: 'too old' }),
    ).toHaveCount(0);
  });

  test('an older server keeps done syncing and says once that it is too old', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    server.isOldServer = true;

    await editTitle(page, 'Buy tent', 'Buy tent @tomorrow 10:00');
    const sent = await tomorrowAtTen(page);
    await expect
      .poll(() => server.patches.map((p) => [p.status, p.body]), { timeout: 15000 })
      .toEqual([[422, { scheduledAt: sent }]]);
    await expect(
      page.locator('mat-snack-bar-container', { hasText: /push failed/i }),
    ).toHaveCount(0);

    await taskPage.markTaskAsDone(taskRow(page, 'Buy tent'));
    await expect
      .poll(() => server.tasks.get(TASK_ID)!.done, { timeout: 15000 })
      .toBe(true);
    // The time is no longer sent to this server.
    expect(server.patches.slice(1).map((p) => p.body)).toEqual([{ done: true }]);
    expect(server.tasks.get(TASK_ID)!.scheduledAt).toBeNull();

    await page.locator('.e2e-toggle-issue-provider-panel').click();
    const tooOld = page.locator('plainspace-reconnect-notice .callout', {
      hasText: 'too old',
    });
    await expect(tooOld).toHaveCount(1);
    await expect(tooOld).toBeVisible();
  });
});
