import { type Page, type Route } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

// Never resolves: the routes below answer every request to it.
const SERVER = 'https://sync.e2e.invalid';
const REQUEST_ID = 'a'.repeat(22);
// eslint-disable-next-line @typescript-eslint/naming-convention
const CORS = { 'Access-Control-Allow-Origin': '*' };

const json = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({ status, headers: CORS, json: body });

const openSignIn = async (page: Page): Promise<void> => {
  await page.locator('button.sync-btn').first().click({ noWaitAfter: true });
  const signIn = page.locator('dialog-sync-setup');
  // The recommended path has the focus, not the other providers or the server icon.
  await expect(signIn.locator('.e2e-sign-in')).toBeFocused();
  await signIn.locator('.e2e-sign-in-change-server').click();
  await signIn.locator('.e2e-sign-in-server').fill(SERVER);
  await signIn.locator('.e2e-sign-in').click();
};

/**
 * The SuperSync sign-in dialog against a stand-in server; the real server
 * round trip is covered by supersync-browser-sign-in.spec.ts.
 */
test.describe('Sync sign-in dialog', () => {
  test('opens the server page, shows the code and offers a retry once cancelled there', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    let answer = 'pending';
    await page.context().route(`${SERVER}/**`, (route) => {
      const url = route.request().url();
      if (url.endsWith('/api/connect/requests')) {
        return json(route, 200, {
          requestId: REQUEST_ID,
          pollSecret: 's'.repeat(43),
          matchCode: 'K7Q-4PX',
          expiresAt: Date.now() + 600_000,
          pollIntervalMs: 1000,
        });
      }
      if (url.endsWith('/poll')) return json(route, 200, { status: answer });
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'Login' });
    });

    const serverPagePromise = page.context().waitForEvent('page');
    await openSignIn(page);
    const serverPage = await serverPagePromise;
    await serverPage.waitForURL((url) => url.href === `${SERVER}/?r=${REQUEST_ID}`);

    const signIn = page.locator('dialog-sync-setup');
    await expect(signIn.locator('.e2e-sign-in-match-code')).toHaveText('K7Q-4PX');
    answer = 'denied';
    await expect(signIn.locator('.e2e-sign-in-try-again')).toBeVisible({
      timeout: 10000,
    });
  });

  test('falls back to pasting a token on a server without browser sign-in', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page
      .context()
      .route(`${SERVER}/**`, (route) => json(route, 404, { error: 'Not Found' }));

    await openSignIn(page);

    const signIn = page.locator('dialog-sync-setup');
    await expect(signIn.locator('.e2e-sign-in-access-token')).toBeVisible();
    await expect(signIn.locator('.e2e-sign-in-save-token')).toBeDisabled();
  });
});
