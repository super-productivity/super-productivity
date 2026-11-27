import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  SUPERSYNC_BASE_URL,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * A new device signs in to SuperSync through the server's login page and the
 * app continues by itself: no token is copied. The page's login is skipped by
 * handing it the account's token the way its magic link does.
 */
test.describe('@supersync SuperSync browser sign-in', () => {
  test('signs in through the browser, then syncs with another device', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const config = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      const { page } = clientA;
      await clientA.sync.clickSyncBtn({ noWaitAfter: true });
      const signIn = page.locator('dialog-sync-setup');
      await signIn.locator('.e2e-sign-in-change-server').click();
      await signIn.locator('.e2e-sign-in-server').fill(SUPERSYNC_BASE_URL);

      const serverPagePromise = clientA.context.waitForEvent('page');
      await signIn.locator('.e2e-sign-in').click();
      const serverPage = await serverPagePromise;
      await serverPage.waitForURL((url) => url.searchParams.has('r'));
      expect(serverPage.url().startsWith(SUPERSYNC_BASE_URL)).toBe(true);
      const matchCode = signIn.locator('.e2e-sign-in-match-code');
      await expect(matchCode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);

      await serverPage.evaluate(
        (token) => sessionStorage.setItem('loginToken', token),
        user.token,
      );
      await serverPage.reload();
      await expect(serverPage.locator('#connect-code')).toHaveText(
        (await matchCode.textContent())!.trim(),
      );
      await serverPage.locator('#connect-approve-btn').click();
      await expect(serverPage.locator('#connect-title')).toHaveText('Device connected');

      // The first device sets the encryption password once the setup sync ends.
      await expect(signIn).toBeHidden({ timeout: 15000 });
      const setupPassword = page.locator('dialog-enable-encryption');
      await expect(setupPassword).toBeVisible({ timeout: 20000 });
      const submit = setupPassword.locator('.e2e-setup-encrypt-submit');
      // The dialog's auto-focus can move focus back to the first field mid-fill,
      // appending the confirm value there; re-fill until the passwords match.
      await expect(async () => {
        await setupPassword.locator('.e2e-setup-encrypt-password').fill(config.password!);
        await setupPassword
          .locator('.e2e-setup-encrypt-confirm-password')
          .fill(config.password!);
        await expect(submit).toBeEnabled({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
      await submit.click();

      // Then the finish screen confirms sync is on.
      const finished = page.locator('dialog-sync-finished');
      await expect(finished).toBeVisible({ timeout: 20000 });
      await expect(finished.locator('.e2e-sync-finished-count')).toHaveText(/\d+/);
      await finished.locator('.e2e-sync-finished-close').click();
      await expect(finished).toBeHidden();

      const taskName = `SignedIn-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(config);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
