import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  activeProviderTab as activeTab,
  openProviderTab,
  providerToken,
} from '../../utils/plainspace-fake';

// Plainspace has no E2E harness in this repo, so its integration API is stubbed
// here with a small stateful fake that answers with the real wire shapes (`SPTask`,
// `/me`). The server side is covered by Plainspace's own integration tests.
//
// Release 0 of the multi-user collaboration plan (#11007):
// - an offline poll is quiet and never asks to reconnect;
// - a revoked token (401) asks to reconnect on that provider;
// - reconnecting writes the new token only to providers holding the revoked one
//   (#8616), a provider of another host/account keeps its own;
// - "Copy invite link" copies the Space URL (share success snack, project menu).

const HOST = 'https://plainspace.org';
const OTHER_HOST = 'https://other-plainspace.e2e';
const SPACE = {
  id: 'space-alpha-id',
  name: 'Alpha',
  slug: 'alpha',
  memberDisplayName: 'Me',
  role: 'owner',
};

const SPACE_B = {
  id: 'space-beta-id',
  name: 'Beta',
  slug: 'beta',
  memberDisplayName: 'Me',
  role: 'member',
};

interface TaskRequest {
  host: string;
  token: string;
  status: number;
}

interface FakePlainspace {
  /** `${host} ${token}` → account email; a token is only valid on its host. */
  tokens: Map<string, string>;
  isTasksOffline: boolean;
  abortedTaskRequests: number;
  taskRequests: TaskRequest[];
}

const installFakePlainspace = async (page: Page): Promise<FakePlainspace> => {
  const server: FakePlainspace = {
    tokens: new Map([
      [`${HOST} pat_old`, 'me@e2e.test'],
      [`${OTHER_HOST} pat_other_account`, 'other@e2e.test'],
    ]),
    isTasksOffline: false,
    abortedTaskRequests: 0,
    taskRequests: [],
  };
  const cors = {
    ['access-control-allow-origin']: '*',
    ['access-control-allow-headers']: 'authorization, content-type',
    ['access-control-allow-methods']: 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  const spTask = (host: string, space: typeof SPACE): Record<string, unknown> => ({
    id: `task-${space.slug}`,
    title: `${space.name} task`,
    done: false,
    projectId: space.id,
    projectName: space.name,
    projectSlug: space.slug,
    listId: 'list-1',
    url: `${host}/${space.slug}/item/task-${space.slug}`,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    scheduledAt: null,
    isRecurring: false,
  });

  await page.route(
    /^https:\/\/(plainspace\.org|other-plainspace\.e2e)\/api\/integration\//,
    async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      const url = new URL(req.url());
      const host = url.origin;
      const space = host === HOST ? SPACE : SPACE_B;
      const path = url.pathname.replace('/api/integration', '');
      if (path === '/tasks' && server.isTasksOffline) {
        server.abortedTaskRequests++;
        await route.abort('internetdisconnected');
        return;
      }
      const token = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');
      const email = server.tokens.get(`${host} ${token}`);
      if (path === '/tasks') {
        server.taskRequests.push({ host, token, status: email ? 200 : 401 });
      }
      if (!email) {
        await route.fulfill({
          status: 401,
          headers: cors,
          json: { error: 'Unauthorized' },
        });
        return;
      }
      if (path === '/me') {
        await route.fulfill({ headers: cors, json: { email, projects: [space] } });
      } else if (path === '/tasks') {
        await route.fulfill({ headers: cors, json: { tasks: [spTask(host, space)] } });
      } else if (path === '/claimable-tasks') {
        await route.fulfill({ headers: cors, json: { tasks: [] } });
      } else {
        await route.fulfill({ status: 404, headers: cors, json: { error: 'Not found' } });
      }
    },
  );
  return server;
};

const lastTaskRequest = (server: FakePlainspace, host: string): TaskRequest | undefined =>
  server.taskRequests.filter((r) => r.host === host).pop();

const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.clipboard.readText());

// The dialog's input is in the DOM before its first change detection binds
// ngModel (zoneless), and that binding writes '' over anything filled earlier.
// The Connect label renders in the same pass, so wait for it before filling.
// The dialog opens on email-code connect; pasting a token is its browser step.
const connectWithToken = async (page: Page, token: string): Promise<void> => {
  const connectDialog = page.locator('plainspace-connect-dialog');
  await connectDialog.getByRole('button', { name: 'Use the browser instead' }).click();
  const connectBtn = connectDialog.getByRole('button', { name: 'Connect', exact: true });
  await expect(connectBtn).toBeVisible();
  await connectDialog.locator('input[type="password"]').fill(token);
  await expect(connectBtn).toBeEnabled();
  await connectBtn.click();
};

test.describe('Plainspace Release 0', () => {
  test('offline stays quiet, a revoked token asks to reconnect, reconnect replaces only that token, invite link copies', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    test.setTimeout(120000);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin,
    });
    await workViewPage.waitForTaskList();
    const server = await installFakePlainspace(page);
    // The first poll after sharing runs while Plainspace is unreachable.
    server.isTasksOffline = true;

    // Share a project: connect with the first token and link the existing space.
    await projectPage.createProject('Shared');
    await projectPage.openProjectContextMenu('Shared');
    await page.getByRole('menuitem', { name: /Collaborate on Plainspace/ }).click();
    const connectDialog = page.locator('plainspace-connect-dialog');
    await connectWithToken(page, 'pat_old');
    const picker = page.locator('plainspace-space-picker-dialog');
    // Item 4: the share dialog says what is stored on the Plainspace host.
    await expect(picker).toContainText(
      'Task titles, done state and scheduled times of shared tasks are stored on plainspace.org',
    );
    await picker.getByRole('button', { name: 'Link space' }).click();
    await expect(picker).toBeHidden();

    // Item 3: the share success snack copies the invite link (the Space URL).
    const successSnack = page.locator('mat-snack-bar-container', {
      hasText: 'Project shared on Plainspace',
    });
    await successSnack.getByRole('button', { name: 'Copy invite link' }).click();
    await expect
      .poll(() => readClipboard(page), { timeout: 5000 })
      .toBe(`${HOST}/${SPACE.slug}`);

    // Offline poll: no error snack, no reconnect notice.
    await expect
      .poll(() => server.abortedTaskRequests, { timeout: 30000 })
      .toBeGreaterThan(0);
    await page.locator('.e2e-toggle-issue-provider-panel').click();
    await expect(page.locator('issue-panel')).toBeVisible();
    const reconnectNotice = activeTab(page).locator(
      'plainspace-reconnect-notice .callout',
    );
    await openProviderTab(page, SPACE.id);
    await expect(reconnectNotice).toHaveCount(0);
    await expect(
      page.locator('mat-snack-bar-container', { hasText: /Failed to poll/ }),
    ).toHaveCount(0);

    // Plainspace revokes the old token (a new one was minted elsewhere) and is
    // reachable again. Adding a second provider (another host and account,
    // bound to the Inbox so it polls too) restarts the poll timer.
    server.tokens.delete(`${HOST} pat_old`);
    server.tokens.set(`${HOST} pat_new`, 'me@e2e.test');
    server.isTasksOffline = false;
    await page.locator('issue-panel .mat-mdc-tab').last().click();
    await page.getByRole('button', { name: 'Plainspace', exact: true }).click();
    const editDialog = page.locator('dialog-edit-issue-provider');
    await editDialog.locator('input[id*="host"]').fill(OTHER_HOST);
    await editDialog.locator('input[id*="spaceId"]').fill(SPACE_B.id);
    await editDialog.locator('input[id*="token"]').fill('pat_other_account');
    await editDialog.getByRole('button', { name: /Advanced Config/i }).click();
    await editDialog.locator('mat-select[id*="defaultProjectId"]').click();
    await page.getByRole('option', { name: 'Inbox' }).click();
    await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editDialog).toBeHidden();

    // Item 2: the 401 shows "reconnect" on the shared project's provider only;
    // the other host's provider polls fine and shows nothing.
    await expect
      .poll(() => lastTaskRequest(server, HOST)?.status, { timeout: 30000 })
      .toBe(401);
    await expect
      .poll(() => lastTaskRequest(server, OTHER_HOST)?.status, { timeout: 30000 })
      .toBe(200);
    await openProviderTab(page, SPACE_B.id);
    await expect(activeTab(page).locator('header .title')).toHaveText(SPACE_B.id);
    await expect(reconnectNotice).toHaveCount(0);
    await openProviderTab(page, SPACE.id);
    await expect(reconnectNotice).toBeVisible();
    await expect(reconnectNotice).toContainText('Plainspace rejected the connection');
    await expect(
      page.locator('mat-snack-bar-container', { hasText: /Failed to poll/ }),
    ).toHaveCount(0);

    // Item 1: reconnect with the new token.
    await reconnectNotice.getByRole('button', { name: 'Reconnect' }).click();
    await connectWithToken(page, 'pat_new');
    await expect(connectDialog).toBeHidden();
    await expect(reconnectNotice).toHaveCount(0);
    // The token change restarts polling: the shared project's provider now
    // polls with the new token, and the other host's provider still polls with
    // its own (the stub rejects a token on the wrong host, so a misrouted
    // replacement would show up as a 401 and a reconnect notice there).
    const requestsBeforeRestart = server.taskRequests.length;
    await expect
      .poll(
        () =>
          server.taskRequests
            .slice(requestsBeforeRestart)
            .filter((r) => r.status === 200)
            .map((r) => `${r.host} ${r.token}`)
            .sort(),
        { timeout: 30000 },
      )
      .toEqual(
        expect.arrayContaining([`${HOST} pat_new`, `${OTHER_HOST} pat_other_account`]),
      );
    expect(
      server.taskRequests.slice(requestsBeforeRestart).filter((r) => r.status !== 200),
    ).toEqual([]);
    await openProviderTab(page, SPACE_B.id);
    await expect(reconnectNotice).toHaveCount(0);

    expect(await providerToken(page, SPACE.id)).toBe('pat_new');
    expect(await providerToken(page, SPACE_B.id)).toBe('pat_other_account');

    // Item 3: the shared project's menu copies the invite link too.
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await projectPage.openProjectContextMenu('Shared');
    await page.getByRole('menuitem', { name: 'Copy invite link' }).click();
    await expect
      .poll(() => readClipboard(page), { timeout: 5000 })
      .toBe(`${HOST}/${SPACE.slug}`);
  });

  // #8616 state: an integration still holds an older, revoked token while this
  // device's saved account (and the project it shared) holds the current one.
  // Minting a new token revokes the current one too, so one reconnect has to
  // move both groups; otherwise reconnecting either would break the other.
  test('one reconnect moves every revoked token of the account', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    test.setTimeout(120000);
    await workViewPage.waitForTaskList();
    const server = await installFakePlainspace(page);
    // pat_old was revoked when pat_mid was minted.
    server.tokens.delete(`${HOST} pat_old`);
    server.tokens.set(`${HOST} pat_mid`, 'me@e2e.test');

    // An integration still on the revoked token, bound to the Inbox so it polls
    // (addressed by the space slug, so its tab reads "alpha").
    await page.locator('.e2e-toggle-issue-provider-panel').click();
    await expect(page.locator('issue-panel')).toBeVisible();
    await page.locator('issue-panel .mat-mdc-tab').last().click();
    await page.getByRole('button', { name: 'Plainspace', exact: true }).click();
    const editDialog = page.locator('dialog-edit-issue-provider');
    await editDialog.locator('input[id*="host"]').fill(HOST);
    await editDialog.locator('input[id*="spaceId"]').fill(SPACE.slug);
    await editDialog.locator('input[id*="token"]').fill('pat_old');
    await editDialog.getByRole('button', { name: /Advanced Config/i }).click();
    await editDialog.locator('mat-select[id*="defaultProjectId"]').click();
    await page.getByRole('option', { name: 'Inbox' }).click();
    await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editDialog).toBeHidden();
    await page.locator('.e2e-toggle-issue-provider-panel').click();

    // Share a project with the current token: saved account and provider hold it.
    await projectPage.createProject('Shared');
    await projectPage.openProjectContextMenu('Shared');
    await page.getByRole('menuitem', { name: /Collaborate on Plainspace/ }).click();
    const connectDialog = page.locator('plainspace-connect-dialog');
    await connectWithToken(page, 'pat_mid');
    const picker = page.locator('plainspace-space-picker-dialog');
    await picker.getByRole('button', { name: 'Link space' }).click();
    await expect(picker).toBeHidden();

    // The old integration's poll is rejected.
    await expect
      .poll(
        () => server.taskRequests.some((r) => r.token === 'pat_old' && r.status === 401),
        { timeout: 30000 },
      )
      .toBe(true);
    await page.locator('.e2e-toggle-issue-provider-panel').click();
    await expect(page.locator('issue-panel')).toBeVisible();
    const reconnectNotice = activeTab(page).locator(
      'plainspace-reconnect-notice .callout',
    );
    await openProviderTab(page, SPACE.slug);
    await expect(reconnectNotice).toBeVisible();

    // Reconnecting mints pat_new, which revokes pat_mid as well.
    server.tokens.delete(`${HOST} pat_mid`);
    server.tokens.set(`${HOST} pat_new`, 'me@e2e.test');
    await reconnectNotice.getByRole('button', { name: 'Reconnect' }).click();
    await connectWithToken(page, 'pat_new');
    await expect(connectDialog).toBeHidden();

    // Both integrations now poll with the new token and nothing is rejected.
    const requestsBeforeRestart = server.taskRequests.length;
    await expect
      .poll(
        () =>
          server.taskRequests
            .slice(requestsBeforeRestart)
            .filter((r) => r.token === 'pat_new' && r.status === 200).length,
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    expect(await providerToken(page, SPACE.slug)).toBe('pat_new');
    expect(await providerToken(page, SPACE.id)).toBe('pat_new');
    expect(
      server.taskRequests.slice(requestsBeforeRestart).filter((r) => r.status !== 200),
    ).toEqual([]);
    await openProviderTab(page, SPACE.id);
    await expect(reconnectNotice).toHaveCount(0);
  });
});
