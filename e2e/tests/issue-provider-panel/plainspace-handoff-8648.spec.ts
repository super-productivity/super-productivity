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

// Phase 2 of the multi-user collaboration plan
// (docs/plans/2026-10-21-multi-user-collaboration.md): hand a task to someone
// from the task context menu. Afterwards the task behaves like one reassigned
// in Plainspace. Plainspace has no E2E harness here, so the integration API is
// a stateful `page.route` fake (see plainspace-fake.ts).

const TASK_ID = 'task-1';

const taskRow = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

const setUp = async (page: Page, projectPage: ProjectPage): Promise<FakePlainspace> => {
  const server = await installFakePlainspace(page);
  server.addAssignedTask(TASK_ID, 'Buy tent');
  await projectPage.createProject('Camping');
  await addPlainspaceProvider(page, /Camping/);
  await projectPage.navigateToProjectByName('Camping');
  await expect(taskRow(page, 'Buy tent')).toBeVisible({ timeout: 30000 });
  return server;
};

const openContextMenu = async (page: Page, title: string): Promise<void> => {
  await taskRow(page, title).locator('task-title').first().click({ button: 'right' });
  await expect(page.locator('.mat-mdc-menu-panel').first()).toBeVisible();
};

const menuItem = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.getByRole('menuitem', { name });

const snack = (page: Page, text: string): ReturnType<Page['locator']> =>
  page.locator('mat-snack-bar-container', { hasText: text });

const notInList = (page: Page): ReturnType<Page['locator']> =>
  page.locator('issue-sync-state .callout', {
    hasText: 'No longer in your Plainspace list',
  });

const openDetail = async (page: Page, title: string): Promise<void> => {
  const panel = page.locator('task-detail-panel');
  if (!(await panel.isVisible())) {
    const row = taskRow(page, title);
    await row.hover();
    await row.getByRole('button', { name: 'Show/hide task panel' }).click();
  }
  await expect(panel).toBeVisible();
};

const renameTask = async (page: Page, title: string, newTitle: string): Promise<void> => {
  const row = taskRow(page, title);
  const taskId = await row.getAttribute('data-task-id');
  await row.locator('task-title').click();
  const textarea = page.locator(`task[data-task-id="${taskId}"] textarea`).first();
  await expect(textarea).toBeVisible();
  await textarea.fill(newTitle);
  await page.keyboard.press('Tab');
  await expect(taskRow(page, newTitle)).toBeVisible();
};

/**
 * Renames while offline and waits until every push of the rename has failed
 * (a rename can push more than once). Going back online earlier could let one
 * of them reach Plainspace, leaving nothing pending.
 */
const renameOffline = async (
  page: Page,
  server: FakePlainspace,
  title: string,
  newTitle: string,
): Promise<void> => {
  server.isOffline = true;
  await renameTask(page, title, newTitle);
  await expect
    .poll(() => server.offlineRequests, { timeout: 15000 })
    .toContain(`GET /tasks/${TASK_ID}`);
  // Deliberate: a later push of the same rename would arrive meanwhile.
  await page.waitForTimeout(2000);
};

/** Restarts the app; the update and import polls run 8 s after load. */
const restart = async (page: Page, server: FakePlainspace): Promise<void> => {
  const before = successfulPolls(server);
  await page.reload();
  await waitForPollAfter(page, server, before);
};

/**
 * After a handoff the task is no longer mine: it says so, offers no further
 * handoff, and a local edit is not pushed. Reassigned back, it syncs again.
 */
const expectNoLongerMineThenBack = async (
  page: Page,
  server: FakePlainspace,
): Promise<void> => {
  await openDetail(page, 'Buy tent');
  await expect(notInList(page)).toBeVisible();

  await openContextMenu(page, 'Buy tent');
  await expect(menuItem(page, 'Release to Space')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const patchesBefore = server.patches.length;
  await renameTask(page, 'Buy tent', 'Buy a tent');
  // Deliberate: a push would arrive meanwhile.
  await page.waitForTimeout(2000);
  expect(server.patches.length).toBe(patchesBefore);

  // Someone gives it back in Plainspace: the next poll lists it again, and
  // the rename made meanwhile is pushed.
  server.assignedIds.add(TASK_ID);
  await restart(page, server);
  await expect
    .poll(() => server.tasks.get(TASK_ID)!.title, { timeout: 15000 })
    .toBe('Buy a tent');
  await openDetail(page, 'Buy a tent');
  await expect(notInList(page)).toHaveCount(0);
};

test.describe('Plainspace handoff (#8648)', () => {
  test.setTimeout(180000);

  test('assign to a member: the task is no longer mine, then syncs again when given back', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await openContextMenu(page, 'Buy tent');
    await menuItem(page, 'Assign to…').click();
    await menuItem(page, 'Bob').click();

    await expect(snack(page, 'Assigned to Bob in Plainspace.')).toBeVisible();
    expect(server.patches).toEqual([
      { id: TASK_ID, body: { assigneeId: 'member-bob' }, status: 200 },
    ]);
    expect(server.assignedIds.has(TASK_ID)).toBe(false);

    await expectNoLongerMineThenBack(page, server);
  });

  test('release to the Space: the task is no longer mine, then syncs again when given back', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await openContextMenu(page, 'Buy tent');
    await menuItem(page, 'Release to Space').click();

    await expect(snack(page, 'Released to the Space in Plainspace.')).toBeVisible();
    expect(server.patches).toEqual([
      { id: TASK_ID, body: { assigneeId: null }, status: 200 },
    ]);

    await expectNoLongerMineThenBack(page, server);
  });

  test('a rename that has not reached Plainspace yet is pushed before the handoff', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    // Renamed while Plainspace can't be reached: the push fails and the
    // rename stays pending until the next poll, minutes away.
    await renameOffline(page, server, 'Buy tent', 'Buy a bigger tent');
    server.isOffline = false;

    // Handed off before that poll: the rename is pushed first, then the
    // assignee alone, so the Space has the title the task was handed off with.
    await openContextMenu(page, 'Buy a bigger tent');
    await menuItem(page, 'Assign to…').click();
    await menuItem(page, 'Bob').click();

    await expect(snack(page, 'Assigned to Bob in Plainspace.')).toBeVisible();
    expect(server.patches).toEqual([
      { id: TASK_ID, body: { title: 'Buy a bigger tent' }, status: 200 },
      { id: TASK_ID, body: { assigneeId: 'member-bob' }, status: 200 },
    ]);
    expect(server.tasks.get(TASK_ID)!.title).toBe('Buy a bigger tent');
  });

  test('a pending rename that still cannot be pushed keeps the task mine and says why', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);

    await renameOffline(page, server, 'Buy tent', 'Buy a bigger tent');
    // Reachable again, but Plainspace fails every write for now.
    server.isOffline = false;
    server.isPatchServerError = true;

    await openContextMenu(page, 'Buy a bigger tent');
    await menuItem(page, 'Release to Space').click();

    await expect(
      snack(page, 'Not handed off: your latest changes to this task'),
    ).toBeVisible();
    // Only the rename was tried; the task was not handed off without it.
    expect(server.patches).toEqual([
      { id: TASK_ID, body: { title: 'Buy a bigger tent' }, status: 500 },
    ]);
    expect(server.assignedIds.has(TASK_ID)).toBe(true);
    await openDetail(page, 'Buy a bigger tent');
    await expect(notInList(page)).toHaveCount(0);
  });

  test('an older server says it is too old to assign and the task stays mine', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUp(page, projectPage);
    server.isOldServer = true;

    // No members endpoint: 404.
    await openContextMenu(page, 'Buy tent');
    await menuItem(page, 'Assign to…').click();
    const membersSnack = snack(page, 'Plainspace server too old to assign.');
    await expect(membersSnack).toBeVisible();
    expect(server.patches).toEqual([]);
    // Error snacks stay 10s. Close this one, so only the 422's own snack can
    // pass the check below (and two containers never match during the swap).
    await membersSnack.locator('button.close').click();
    await expect(membersSnack).toHaveCount(0);

    // A PATCH with only assigneeId: 422.
    await page.keyboard.press('Escape');
    await openContextMenu(page, 'Buy tent');
    await menuItem(page, 'Release to Space').click();
    await expect
      .poll(() => server.patches.map((p) => p.status), { timeout: 15000 })
      .toEqual([422]);
    await expect(snack(page, 'Plainspace server too old to assign.')).toBeVisible();

    await openDetail(page, 'Buy tent');
    await expect(page.locator('issue-header')).toBeVisible();
    await expect(notInList(page)).toHaveCount(0);
    expect(server.assignedIds.has(TASK_ID)).toBe(true);
  });
});
