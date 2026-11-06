import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import {
  activeProviderTab,
  addPlainspaceProvider,
  FakePlainspace,
  installFakePlainspace,
  PLAINSPACE_HOST,
  PLAINSPACE_SPACE,
  providerToken,
} from '../../utils/plainspace-fake';

// Connect to Plainspace, or sign up, inside SP: email → 6-digit code → key,
// through the endpoints Plainspace's own connect page uses. Plainspace has no
// E2E harness here, so they are a stateful `page.route` fake answering with the
// real wire shapes (see plainspace-fake.ts).

const ME = 'me@e2e.test';

const dialog = (page: Page): ReturnType<Page['locator']> =>
  page.locator('plainspace-connect-dialog');

/** Opens the connect dialog by sharing a new project (no account yet). */
const shareProject = async (
  page: Page,
  projectPage: ProjectPage,
  name: string,
): Promise<void> => {
  await projectPage.createProject(name);
  await projectPage.openProjectContextMenu(name);
  await page.getByRole('menuitem', { name: /Collaborate on Plainspace/ }).click();
};

// A dialog input is in the DOM before its first change detection binds ngModel
// (zoneless), and that binding writes '' over anything filled earlier; the
// step's button renders in the same pass, so wait for it before filling.
const fillAndSubmit = async (
  page: Page,
  input: string,
  value: string,
  button: string,
): Promise<void> => {
  const submit = dialog(page).getByRole('button', { name: button, exact: true });
  await expect(submit).toBeVisible();
  await dialog(page).locator(input).fill(value);
  await expect(submit).toBeEnabled();
  await submit.click();
};

const enterEmail = (page: Page, email: string): Promise<void> =>
  fillAndSubmit(page, '.e2e-plainspace-email', email, 'Email me a code');

const enterCode = (page: Page, code: string): Promise<void> =>
  fillAndSubmit(page, '.e2e-plainspace-code', code, 'Connect');

const sentCode = async (server: FakePlainspace, email: string): Promise<string> => {
  await expect.poll(() => server.codes.get(email)).toBeTruthy();
  return server.codes.get(email)!;
};

const openIssuePanel = async (page: Page): Promise<void> => {
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await expect(page.locator('issue-panel')).toBeVisible();
};

const shareSucceeded = (page: Page): Promise<void> =>
  expect(
    page.locator('mat-snack-bar-container', { hasText: 'Project shared on Plainspace' }),
  ).toBeVisible();

test.describe('Plainspace: connect inside the app', () => {
  test.beforeEach(async ({ workViewPage }) => {
    await workViewPage.waitForTaskList();
  });

  test('a new account from Share gets a Space named after the project', async ({
    page,
    projectPage,
  }) => {
    test.setTimeout(90000);
    const server = await installFakePlainspace(page);
    // A brand-new account has no Spaces yet.
    server.spaces = [];
    await shareProject(page, projectPage, 'Garden');

    // The consent line links to the host's own terms.
    await expect(dialog(page).getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      `${PLAINSPACE_HOST}/terms`,
    );
    await expect(
      dialog(page).getByRole('link', { name: 'Privacy Policy' }),
    ).toHaveAttribute('href', `${PLAINSPACE_HOST}/privacy`);

    await enterEmail(page, 'new@e2e.test');
    await enterCode(page, await sentCode(server, 'new@e2e.test'));
    await expect(dialog(page)).toContainText('no Plainspace account for this email');
    await fillAndSubmit(page, '.e2e-plainspace-name', 'Ann', 'Create account');

    await expect(dialog(page)).toBeHidden();
    // The new Space is linked directly: no picker offering to create another.
    await shareSucceeded(page);
    await expect(page.locator('plainspace-space-picker-dialog')).toHaveCount(0);
    expect(server.createdProjects).toEqual([
      // The project page prefixes names per worker.
      {
        name: expect.stringMatching(/Garden$/),
        displayName: 'Ann',
        email: 'new@e2e.test',
      },
    ]);
    const space = server.spaces[0];
    await openIssuePanel(page);
    expect(await providerToken(page, space.id)).toBe(
      server.accounts.get('new@e2e.test')!.activeToken,
    );
  });

  test('a returning account connects with its code; a wrong code is refused first', async ({
    page,
    projectPage,
  }) => {
    test.setTimeout(90000);
    const server = await installFakePlainspace(page);
    server.accounts.set(ME, { activeToken: null });
    await shareProject(page, projectPage, 'Shared');

    await enterEmail(page, ME);
    const code = await sentCode(server, ME);
    await enterCode(page, code === '000000' ? '111111' : '000000');
    await expect(dialog(page).getByRole('alert')).toContainText(
      'That code is wrong or has expired',
    );
    await expect(dialog(page).locator('.e2e-plainspace-code')).toBeVisible();

    await enterCode(page, code);
    await expect(dialog(page)).toBeHidden();
    const picker = page.locator('plainspace-space-picker-dialog');
    await picker.getByRole('button', { name: 'Link space' }).click();
    await expect(picker).toBeHidden();
    await shareSucceeded(page);
    // No account was created, and no key was forced over another.
    expect(server.createdProjects).toEqual([]);
    expect(server.connectRequests.some((r) => r['force'])).toBe(false);
    await openIssuePanel(page);
    expect(await providerToken(page, PLAINSPACE_SPACE.id)).toBe(
      server.accounts.get(ME)!.activeToken,
    );
  });

  test('a key active elsewhere is replaced only when asked, and providers holding it get the new one', async ({
    page,
    projectPage,
  }) => {
    test.setTimeout(120000);
    const server = await installFakePlainspace(page);
    // This device already syncs a provider holding the account's active key
    // (as one synced from another device would), but has no saved account.
    server.accounts.set(ME, { activeToken: 'pat_e2e' });
    await projectPage.createProject('Camping');
    await addPlainspaceProvider(page, /Camping/);

    await shareProject(page, projectPage, 'Shared');
    await enterEmail(page, ME);
    await enterCode(page, await sentCode(server, ME));

    // Asked first; nothing is replaced yet.
    await expect(dialog(page)).toContainText(
      `${ME} already has a Plainspace key active in another app or device`,
    );
    await expect(dialog(page)).toContainText('needs the new one');
    expect(server.revokedTokens.has('pat_e2e')).toBe(false);
    // Using the key this device holds is offered first; replacing is chosen.
    await expect(
      dialog(page).getByRole('button', { name: 'Use existing connection' }),
    ).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Replace key' }).click();
    await expect(dialog(page)).toBeHidden();

    const newToken = server.accounts.get(ME)!.activeToken!;
    expect(newToken).not.toBe('pat_e2e');
    expect(server.revokedTokens.has('pat_e2e')).toBe(true);
    const picker = page.locator('plainspace-space-picker-dialog');
    await picker.getByRole('button', { name: 'Link space' }).click();
    await expect(picker).toBeHidden();
    await shareSucceeded(page);

    // Both providers (the old one and the one just shared) hold the new key,
    // so neither asks to reconnect.
    await openIssuePanel(page);
    expect(await providerTokensWithoutReconnect(page)).toEqual([newToken, newToken]);
  });

  // A second device: the providers came through sync, the saved account (per
  // device) didn't. Using the working key it holds revokes nothing.
  test('a second device uses the working key it already holds instead of replacing it', async ({
    page,
    projectPage,
  }) => {
    test.setTimeout(120000);
    const server = await installFakePlainspace(page);
    server.accounts.set(ME, { activeToken: 'pat_e2e' });
    await projectPage.createProject('Camping');
    await addPlainspaceProvider(page, /Camping/);

    await shareProject(page, projectPage, 'Shared');
    await enterEmail(page, ME);
    await enterCode(page, await sentCode(server, ME));
    await dialog(page).getByRole('button', { name: 'Use existing connection' }).click();
    await expect(dialog(page)).toBeHidden();

    const picker = page.locator('plainspace-space-picker-dialog');
    await picker.getByRole('button', { name: 'Link space' }).click();
    await expect(picker).toBeHidden();
    await shareSucceeded(page);
    expect(server.revokedTokens.size).toBe(0);
    expect(server.accounts.get(ME)!.activeToken).toBe('pat_e2e');
    expect(server.connectRequests.some((r) => r['force'])).toBe(false);
    await openIssuePanel(page);
    expect(await providerTokensWithoutReconnect(page)).toEqual(['pat_e2e', 'pat_e2e']);
  });

  test('a host without email-code connect falls back to the browser', async ({
    page,
    projectPage,
  }) => {
    test.setTimeout(90000);
    const server = await installFakePlainspace(page);
    server.isAuthUnsupported = true;
    await shareProject(page, projectPage, 'Shared');

    await enterEmail(page, ME);
    await expect(dialog(page)).toContainText("can't connect from inside the app");
    await expect(
      dialog(page).getByRole('link', { name: 'Open Plainspace' }),
    ).toHaveAttribute('href', `${PLAINSPACE_HOST}/connect/super-productivity`);
    // The pasted token path is today's.
    await fillAndSubmit(page, 'input[type="password"]', 'pat_e2e', 'Connect');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('plainspace-space-picker-dialog')).toBeVisible();
  });
});

/**
 * Each provider tab's stored token, checking on the way that none asks to
 * reconnect. Both providers here bind the same space, so tabs go by position.
 */
const providerTokensWithoutReconnect = async (page: Page): Promise<string[]> => {
  const tabs = page.locator('issue-panel .mat-mdc-tab');
  // Two providers plus the setup overview, which is last.
  await expect.poll(() => tabs.count(), { timeout: 30000 }).toBe(3);
  const tokens: string[] = [];
  for (let i = 0; i < 2; i++) {
    await tabs.nth(i).click();
    const tab = activeProviderTab(page);
    await expect(tab.locator('header .title')).toHaveText(PLAINSPACE_SPACE.id);
    await expect(tab.locator('plainspace-reconnect-notice .callout')).toHaveCount(0);
    await tab.locator('header button').first().click();
    const editDialog = page.locator('dialog-edit-issue-provider');
    tokens.push(await editDialog.locator('input[id*="token"]').inputValue());
    await page.keyboard.press('Escape');
    await expect(editDialog).toBeHidden();
  }
  return tokens;
};
