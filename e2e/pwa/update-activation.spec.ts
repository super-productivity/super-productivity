import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures/test.fixture';
import { expectNoGlobalError, expectTaskVisible } from '../utils/assertions';
import { waitForAppReady, waitForStatePersistence } from '../utils/waits';

type PwaVersion = 'v1' | 'v2';

const setPwaVersion = async (
  request: APIRequestContext,
  version: PwaVersion,
): Promise<void> => {
  const response = await request.post(`/__e2e/pwa/version/${version}`);
  expect(response.ok()).toBeTruthy();
  const body: unknown = await response.json();
  expect(body).toEqual({ version });
};

const getManifestRequestCount = async (request: APIRequestContext): Promise<number> => {
  const response = await request.get('/__e2e/pwa/manifest-request-count');
  expect(response.ok()).toBeTruthy();
  const count = Number(await response.text());
  expect(Number.isInteger(count)).toBe(true);
  return count;
};

test.describe('Production PWA update activation', () => {
  test.beforeAll(async ({ request }) => {
    await setPwaVersion(request, 'v1');
  });

  test('activates a new cached version without losing persisted data', async ({
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

    const manifestRequestsBeforeControlledReload = await getManifestRequestCount(
      page.request,
    );
    const controlledDocumentMarker = 'PWA_E2E_CONTROLLED_DOCUMENT';
    let didStartControlledDocument = false;
    await page.addInitScript((marker) => console.info(marker), controlledDocumentMarker);
    const initialUpdateCheck = page.waitForEvent('console', {
      predicate: (message) => {
        if (message.text() === controlledDocumentMarker) {
          didStartControlledDocument = true;
          return false;
        }
        return (
          didStartControlledDocument &&
          message
            .text()
            .includes('___________isServiceWorkerUpdateAvailable____________ false')
        );
      },
      timeout: 30000,
    });
    // Bypass this one navigation so it becomes controlled without scheduling
    // Angular's separate navigation-driven idle update check.
    await page.goto('/?ngsw-bypass=true', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await initialUpdateCheck;
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
      )
      .toMatch(/\/ngsw-worker\.js$/);
    await expect(page.locator('meta[name="pwa-e2e-version"]')).toHaveCount(0);

    await expect
      .poll(() => getManifestRequestCount(page.request), { timeout: 15000 })
      .toBeGreaterThanOrEqual(manifestRequestsBeforeControlledReload + 1);
    await page.evaluate(() => history.replaceState(null, '', '/'));

    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-PWA update activation`;
    await workViewPage.addTask(taskTitle);
    await expectTaskVisible(taskPage, taskTitle);
    await waitForStatePersistence(page);

    await setPwaVersion(page.request, 'v2');

    const updateDialogPromise = page.waitForEvent('dialog', { timeout: 30000 });
    await page.reload({ waitUntil: 'commit' });
    const updateDialog = await updateDialogPromise;
    expect(updateDialog.type()).toBe('confirm');
    expect(updateDialog.message()).toBe('New version available. Load new version?');

    const activatedNavigation = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 30000,
    });
    await updateDialog.accept();
    await activatedNavigation;
    await waitForAppReady(page);

    await expect(page.locator('meta[name="pwa-e2e-version"]')).toHaveAttribute(
      'content',
      'v2',
    );
    await expectTaskVisible(taskPage, taskTitle);

    await isolatedContext.setOffline(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      await expect(page.locator('meta[name="pwa-e2e-version"]')).toHaveAttribute(
        'content',
        'v2',
      );
      await expectTaskVisible(taskPage, taskTitle);
      await expect
        .poll(() =>
          page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
        )
        .toMatch(/\/ngsw-worker\.js$/);
      await expectNoGlobalError(page);
    } finally {
      await isolatedContext.setOffline(false);
    }
  });
});
