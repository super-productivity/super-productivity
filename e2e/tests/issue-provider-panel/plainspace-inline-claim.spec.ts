import type { Page, Response } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import {
  addPlainspaceProvider,
  installFakePlainspace,
} from '../../utils/plainspace-fake';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';
import {
  flushPendingWrites,
  skipOnboardingForE2E,
  waitForAppReady,
} from '../../utils/waits';

const PROJECT = 'Help Center';
const TASK_ID = '4d9dd8a6-25aa-4807-9cfc-037eddb37a9e';
const TITLE = 'Update the pricing FAQ';
const CLAIM_PATH = `/api/integration/tasks/${TASK_ID}/claim`;

const openSharedProject = async (page: Page, token: string): Promise<void> => {
  const project = new ProjectPage(page);
  await project.createProject(PROJECT);
  await addPlainspaceProvider(page, PROJECT, token);
  await project.navigateToProjectByName(PROJECT);

  await page.locator('page-title .project-settings-btn').click();
  await page
    .locator('.work-context-menu-panel')
    .getByRole('menuitem', { name: 'Settings', exact: true })
    .click();
  const settings = page.locator('dialog-work-context-settings');
  await settings.getByRole('switch', { name: 'Enable Project Backlog' }).click();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toBeHidden();
  await expect(page.locator('issue-panel')).toBeHidden();
};

const previewRow = (page: Page, title: string): ReturnType<Page['locator']> =>
  page
    .locator('.task-list-wrapper > plainspace-claim-pool .claim-task')
    .filter({ has: page.getByText(title, { exact: true }) });

const claimRow = (page: Page): ReturnType<Page['locator']> => previewRow(page, TITLE);

const localTask = (page: Page, title = TITLE): ReturnType<Page['locator']> =>
  page.locator('task').filter({ has: page.getByText(title, { exact: true }) });

const waitForClaim = (page: Page): Promise<Response> =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith(CLAIM_PATH) && response.request().method() === 'POST',
  );

test('Everyone shows team previews and Only mine hides tasks assigned to others', async ({
  page,
  projectPage,
  taskPage,
  testPrefix,
  workViewPage,
}) => {
  const server = await installFakePlainspace(page);
  server.members.push({ id: 'member-maya', displayName: 'Maya' });
  server.addAssignedTask('teammate-task', 'Review the setup guide', 'member-maya');
  server.addClaimableTask(TASK_ID, TITLE);
  await openSharedProject(page, 'pat_alice');
  const myTitle = `${testPrefix}-Write the onboarding checklist`;
  await workViewPage.addTask(myTitle);

  const everyone = page.getByRole('radio', { name: 'Everyone', exact: true });
  const onlyMine = page.getByRole('radio', { name: 'Only mine', exact: true });
  const teammateTask = previewRow(page, 'Review the setup guide');
  const myTask = localTask(page, myTitle);

  await expect(everyone).toBeChecked();
  await expect(teammateTask.getByText(/Maya/)).toBeVisible();
  await expect(teammateTask.getByRole('button')).toHaveCount(0);
  await expect(
    teammateTask.getByRole('link', {
      name: 'Open in Plainspace — Review the setup guide',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    claimRow(page).getByRole('button', { name: `Claim ${TITLE}` }),
  ).toBeVisible();
  await expect(myTask).toBeVisible();

  await expect(everyone).toHaveAttribute('tabindex', '0');
  await expect(onlyMine).toHaveAttribute('tabindex', '-1');
  await everyone.focus();
  await page.keyboard.press('ArrowRight');
  await expect(onlyMine).toBeFocused();
  await expect(onlyMine).toBeChecked();
  await expect(onlyMine).toHaveAttribute('tabindex', '0');
  await expect(everyone).toHaveAttribute('tabindex', '-1');
  await expect(teammateTask).toHaveCount(0);
  await expect(claimRow(page)).toHaveCount(0);
  await expect(myTask).toBeVisible();

  await everyone.click();
  await expect(everyone).toBeChecked();
  await expect(teammateTask.getByText(/Maya/)).toBeVisible();
  await expect(claimRow(page)).toBeVisible();

  await expect(myTask.getByText('Plainspace', { exact: true })).toBeVisible();
  await expect(myTask.getByText('You', { exact: true })).toBeVisible();
  const localId = await myTask.getAttribute('data-task-id');
  const detailPanel = page.locator('task-detail-panel');
  const notes = detailPanel.locator('inline-markdown');
  const timeSpent = detailPanel.locator('task-detail-item.--estimate .time-val').first();
  const noteText = 'Personal research for the onboarding checklist';
  await myTask.press('t');
  const timeDialog = page.locator('dialog-time-estimate');
  await timeDialog.getByRole('textbox', { name: 'Time Spent', exact: true }).fill('1h');
  await timeDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(timeDialog).toBeHidden();
  await taskPage.openTaskDetail(myTask);
  await expect(timeSpent).toHaveText('1h');

  await detailPanel.getByRole('button', { name: 'Notes / Checklist' }).click();
  const editor = notes.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText(noteText);
  await editor.blur();
  await expect(notes).toContainText(noteText);
  await page
    .getByRole('button', { name: 'Close right panel or drag to resize' })
    .press('Enter');

  await myTask.locator('task-title').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Assign to…', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Maya', exact: true }).click();

  const handedOff = previewRow(page, myTitle);
  await expect(handedOff.getByText(/Maya/)).toBeVisible();
  await expect(myTask).toHaveCount(0);
  await onlyMine.click();
  await expect(handedOff).toHaveCount(0);
  await expect(myTask).toHaveCount(0);

  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  await page.locator('search-page .search-field input').fill(myTitle);
  const releaseTeamOverview = Promise.withResolvers<void>();
  await page.route(
    '**/team-tasks',
    async (route) => {
      await releaseTeamOverview.promise;
      await route.fallback();
    },
    { times: 1 },
  );
  try {
    await page.locator('search-page mat-list-item').filter({ hasText: myTitle }).click();
    await expect(page).toHaveURL(
      new RegExp(`/project/[^/]+/tasks\\?focusItem=${localId}`),
    );
    // Search can focus the native row before the team overview replaces it.
    await expect(myTask).toBeFocused();
  } finally {
    releaseTeamOverview.resolve();
  }
  await expect(everyone).toBeChecked();
  const openLocalCopy = handedOff.getByRole('button', { name: `Local copy ${myTitle}` });
  await expect(openLocalCopy).toBeFocused();
  await expect(openLocalCopy).toHaveClass(/highlight-searched-task/);
  await page.keyboard.press('Enter');
  await expect(notes.getByText(noteText, { exact: true })).toBeVisible();
  await expect(timeSpent).toHaveText('1h');
  await onlyMine.click();
  await expect(detailPanel).toBeHidden();

  await projectPage.createProject('Personal errands');
  await projectPage.navigateToProjectByName('Personal errands');
  await workViewPage.addTask('Buy stamps');
  await expect(page.locator('task').filter({ hasText: 'Buy stamps' })).toBeVisible();
  await expect(everyone).toHaveCount(0);
  await expect(onlyMine).toHaveCount(0);
  await expect(page.locator('plainspace-claim-pool .claim-task')).toHaveCount(0);

  // Maya completes the task while we're away. Its local notes and time remain accessible.
  const handedOffTask = [...server.tasks.values()].find((task) => task.title === myTitle);
  expect(handedOffTask).toBeDefined();
  server.remoteEdit(handedOffTask!.id, { done: true });
  // The team endpoint can identify this copy even when the normal assignment poll fails.
  server.isTasksOffline = true;
  await new ProjectPage(page).navigateToProjectByName(PROJECT);
  await flushPendingWrites(page);
  await page.reload();
  await expect(everyone).toBeChecked();
  await expect(handedOff).toHaveCount(0);
  await expect(myTask.getByText('Local copy', { exact: true })).toBeVisible();
  await myTask.hover();
  await myTask.getByRole('button', { name: 'Show/hide task panel' }).click();
  await expect(
    page.locator('issue-sync-state .callout', {
      hasText: 'No longer in your Plainspace list',
    }),
  ).toBeVisible();
  await expect(notes.getByText(noteText, { exact: true })).toBeVisible();
  await expect(timeSpent).toHaveText('1h');
  await onlyMine.click();
  await expect(myTask).toHaveCount(0);
});

test('an older server keeps owned work in Only mine and unassigned work claimable', async ({
  page,
  workViewPage,
}) => {
  const server = await installFakePlainspace(page);
  server.isOldServer = true;
  server.addClaimableTask(TASK_ID, TITLE);
  await openSharedProject(page, 'pat_alice');
  await workViewPage.addTask('Proofread the setup guide');
  const mine = page.locator('task').filter({ hasText: 'Proofread the setup guide' });
  await expect(mine.getByText('Plainspace', { exact: true })).toBeVisible();
  await flushPendingWrites(page);
  await page.reload();

  await expect(
    claimRow(page).getByRole('button', { name: `Claim ${TITLE}` }),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'Only mine', exact: true }).click();
  await expect(mine.getByText('You', { exact: true })).toBeVisible();
  await expect(claimRow(page)).toHaveCount(0);
});

test('Only mine shows tasks assigned to me while their local import is pending', async ({
  page,
}) => {
  const server = await installFakePlainspace(page);
  server.addAssignedTask(TASK_ID, TITLE);
  server.isTasksOffline = true;
  await openSharedProject(page, 'pat_alice');

  const everyone = page.getByRole('radio', { name: 'Everyone', exact: true });
  const onlyMine = page.getByRole('radio', { name: 'Only mine', exact: true });
  const remoteTask = previewRow(page, TITLE);
  await onlyMine.click();
  await expect(onlyMine).toBeChecked();
  await expect(remoteTask.getByText('You', { exact: true })).toBeVisible();
  await expect(remoteTask.getByRole('button')).toHaveCount(0);
  await expect(
    remoteTask.getByRole('link', { name: 'Open in Plainspace' }),
  ).toBeVisible();
  await expect(localTask(page)).toHaveCount(0);

  await flushPendingWrites(page);
  server.isTasksOffline = false;
  await page.reload();
  await expect(everyone).toBeChecked();
  await onlyMine.click();
  await page.locator('.backlog split button').click();
  await expect(localTask(page)).toBeVisible();
  await expect(localTask(page)).toHaveCount(1);
  await expect(remoteTask).toHaveCount(0);
  await everyone.click();
  await expect(localTask(page)).toBeVisible();
  await expect(remoteTask).toHaveCount(0);
});

test('two members can claim from the project list and only the winner imports the task', async ({
  page,
  browser,
  baseURL,
  contextOptions,
  userAgent,
}) => {
  const server = await installFakePlainspace(page);
  server.tokenEmails.set('pat_alice', 'alice@e2e.test');
  server.tokenEmails.set('pat_bob', 'bob@e2e.test');
  server.members.push({ id: 'member-alice', displayName: 'Alice' });
  server.memberIdsByToken.set('pat_alice', 'member-alice');
  server.memberIdsByToken.set('pat_bob', 'member-bob');
  server.addClaimableTask(TASK_ID, TITLE);
  const remaining = server.addClaimableTask(
    'ba133a23-b064-4e55-91e7-34985007fd50',
    'Review setup guide',
  );
  await openSharedProject(page, 'pat_alice');

  const otherContext = await browser.newContext({
    ...contextOptions,
    baseURL,
    // Keep the first test context's test-only onboarding defaults.
    userAgent: `${userAgent ?? 'Chrome'} PLAYWRIGHT`,
  });
  try {
    const other = await otherContext.newPage();
    const errors = attachPageErrorCollector(other, 'second member');
    installDevErrorDialogHandler(other, 'second member');
    await other.addInitScript(skipOnboardingForE2E);
    await installFakePlainspace(other, server);
    await other.goto('/');
    await waitForAppReady(other);

    await openSharedProject(other, 'pat_bob');

    await expect(claimRow(page)).toBeVisible();
    await expect(claimRow(other)).toBeVisible();
    const claimButtonName = `Claim ${TITLE}`;
    const winnerClaim = claimRow(page).getByRole('button', { name: claimButtonName });
    const loserClaim = claimRow(other).getByRole('button', { name: claimButtonName });
    await expect(winnerClaim).toBeVisible();
    await expect(loserClaim).toBeVisible();
    await expect(localTask(page)).toHaveCount(0);
    await expect(localTask(other)).toHaveCount(0);
    await expect(page.locator('.backlog split button')).toBeVisible();
    await expect(page.locator('backlog')).toHaveCount(0);

    await claimRow(page).getByRole('link', { name: 'Open in Plainspace' }).focus();
    await page.keyboard.press('Tab');
    await expect(winnerClaim).toBeFocused();
    const resumeClaim = Promise.withResolvers<void>();
    let claimAttempts = 0;
    await page.route(`**${CLAIM_PATH}`, async (route) => {
      claimAttempts++;
      await resumeClaim.promise;
      await route.fallback();
    });
    const won = waitForClaim(page);
    try {
      await page.keyboard.press('Enter');
      await expect(winnerClaim).toHaveAttribute('aria-busy', 'true');
      await expect(winnerClaim).toBeFocused();
      await expect(winnerClaim.locator('mat-progress-spinner')).toBeVisible();
      await page.keyboard.press('Enter');
    } finally {
      resumeClaim.resolve();
    }
    expect((await won).status()).toBe(200);

    // Bob clicks the same row from the list he loaded before Alice's claim.
    const lost = waitForClaim(other);
    await loserClaim.focus();
    await other.keyboard.press('Enter');
    expect((await lost).status()).toBe(409);
    const conflictMessage = other.locator('mat-snack-bar-container', {
      hasText: /already claimed/i,
    });
    await expect(conflictMessage).toBeVisible();
    await expect(loserClaim).toHaveCount(0);
    await expect(claimRow(other).getByText(/Alice/)).toBeVisible();
    const nextClaim = other.getByRole('button', { name: 'Claim Review setup guide' });
    await expect(nextClaim).toBeFocused();

    // The final preview also disappears if its remote task has been deleted.
    server.tasks.delete(remaining.id);
    server.claimableIds.delete(remaining.id);
    const releaseMissing = Promise.withResolvers<void>();
    await other.route(`**/tasks/${remaining.id}/claim`, async (route) => {
      await releaseMissing.promise;
      await route.fallback();
    });
    try {
      await other.keyboard.press('Enter');
      await expect(nextClaim).toHaveAttribute('aria-busy', 'true');
      await other.keyboard.press('Shift+Tab');
      await expect(previewRow(other, remaining.title).getByRole('link')).toBeFocused();
    } finally {
      releaseMissing.resolve();
    }
    await expect(nextClaim).toHaveCount(0);
    await expect(
      other.getByRole('region', { name: 'Task List', exact: true }),
    ).toBeFocused();
    await other
      .locator('mat-snack-bar-container', { hasText: /no longer available/i })
      .locator('button.close')
      .click();
    await other.locator('.backlog split button').click();
    await expect(other.locator('backlog task-list')).toBeVisible();
    await expect(localTask(other)).toHaveCount(0);

    const claimedTask = localTask(page);
    await expect(claimedTask).toHaveCount(1);
    await expect(page.locator('backlog').getByText(TITLE, { exact: true })).toBeVisible();
    await expect(claimedTask).toBeFocused();
    await expect(claimRow(page)).toHaveCount(0);
    expect(claimAttempts).toBe(1);
    assertNoRuntimeBrowserErrors(errors, 'second member');
  } finally {
    await otherContext.close();
  }
});
