import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  addPlainspaceProvider,
  installFakePlainspace,
  successfulPolls,
  waitForPollAfter,
} from '../../utils/plainspace-fake';
import { waitForMenuSettled } from '../../utils/waits';

// #8790, Release 1 of the multi-user collaboration plan: moving a task into a
// Plainspace-bound project shares it (create, then link), like adding one
// there. Moving it out keeps the link. A failed create stays unlinked and is
// never retried automatically. Plainspace has no E2E harness here, so the
// integration API is a stateful `page.route` fake (see plainspace-fake.ts).

const taskRow = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/** Moves a task to another project through its context menu. */
const moveToProject = async (
  page: Page,
  title: string,
  projectName: RegExp,
): Promise<void> => {
  await taskRow(page, title).first().click({ button: 'right' });
  // A click during the open animation leaves the pointer over the item above
  // once the panel settles, which swaps in its submenu (see waitForMenuSettled).
  await waitForMenuSettled(page);
  const menu = page.locator('.mat-mdc-menu-panel').first();
  await menu
    .locator('button[mat-menu-item]')
    .filter({ has: page.locator('mat-icon:has-text("forward")') })
    .first()
    .click();
  await page.locator('.mat-mdc-menu-panel').nth(1).waitFor({ state: 'visible' });
  await waitForMenuSettled(page);
  await page
    .locator('.mat-mdc-menu-panel')
    .last()
    .locator('button[mat-menu-item]')
    .filter({ hasText: projectName })
    .first()
    .click();
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

/** The Plainspace label a linked task shows under its title. */
const plainspaceLabel = (page: Page, title: string): ReturnType<Page['locator']> =>
  taskRow(page, title).getByText('Plainspace', { exact: true });

test.describe('Plainspace move-in shares (#8790)', () => {
  test.setTimeout(180000);

  test('moving a task into a shared project shares it; moving it out keeps the link', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await installFakePlainspace(page);
    await projectPage.createProject('Camping');
    await addPlainspaceProvider(page, /Camping/);

    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pack stove');
    const title = /Pack stove/;
    await expect(taskRow(page, 'Pack stove')).toBeVisible();
    expect(server.creates).toEqual([]);

    await moveToProject(page, 'Pack stove', /Camping/);
    await expect.poll(() => server.creates.length, { timeout: 15000 }).toBe(1);
    expect(server.creates[0]).toMatch(title);

    await projectPage.navigateToProjectByName('Camping');
    await expect(plainspaceLabel(page, 'Pack stove')).toBeVisible();

    // Moving out keeps the link: nothing is deleted or created.
    await moveToProject(page, 'Pack stove', /Inbox/);
    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await expect(plainspaceLabel(page, 'Pack stove')).toBeVisible();
    // Deliberate: a wrongly triggered delete or create would show up meanwhile.
    await page.waitForTimeout(2000);
    expect(server.creates.length).toBe(1);
    expect(server.assignedIds.has('created-1')).toBe(true);
  });

  test('a failed move-in create snacks, stays unlinked and is not retried', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await installFakePlainspace(page);
    await projectPage.createProject('Camping');
    await addPlainspaceProvider(page, /Camping/);
    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pack stove');

    server.isCreateServerError = true;
    await moveToProject(page, 'Pack stove', /Camping/);
    await expect(
      page.locator('mat-snack-bar-container', { hasText: /Auto-create issue failed/ }),
    ).toBeVisible();
    expect(server.creates.length).toBe(1);

    // A restart and a poll later it is still unlinked and was not created again.
    server.isCreateServerError = false;
    const before = successfulPolls(server);
    await page.reload();
    // No task is linked, so only the import poll requests /tasks.
    await waitForPollAfter(page, server, before, 1);
    await projectPage.navigateToProjectByName('Camping');
    await expect(taskRow(page, 'Pack stove')).toBeVisible();
    await expect(plainspaceLabel(page, 'Pack stove')).toHaveCount(0);
    expect(server.creates.length).toBe(1);
  });
});
