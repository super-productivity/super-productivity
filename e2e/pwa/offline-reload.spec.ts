import { expect, test } from '../fixtures/test.fixture';
import { expectNoGlobalError, expectTaskVisible } from '../utils/assertions';
import { waitForAppReady, waitForStatePersistence } from '../utils/waits';

test.describe('Production PWA offline reload', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.post('/__e2e/pwa/version/v1');
    expect(response.ok()).toBeTruthy();
    const body: unknown = await response.json();
    expect(body).toEqual({ version: 'v1' });
  });

  test('installs the worker and restores persisted data offline', async ({
    page,
    isolatedContext,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return registration?.active?.state === 'activated'
              ? registration.active.scriptURL
              : null;
          }),
        { timeout: 30000 },
      )
      .toMatch(/\/ngsw-worker\.js$/);

    // The first document can install the worker without being controlled by it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
      )
      .toMatch(/\/ngsw-worker\.js$/);

    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-PWA offline reload`;
    await workViewPage.addTask(taskTitle);
    await expectTaskVisible(taskPage, taskTitle);
    await waitForStatePersistence(page);

    await isolatedContext.setOffline(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      await expect
        .poll(() =>
          page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
        )
        .toMatch(/\/ngsw-worker\.js$/);
      await expectTaskVisible(taskPage, taskTitle);
      await expect(
        page.getByRole('menuitem').filter({ hasText: 'Today' }).first(),
      ).toBeVisible();
      await expectNoGlobalError(page);
    } finally {
      await isolatedContext.setOffline(false);
    }
  });
});
