import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures/test.fixture';
import { expectNoGlobalError, expectTaskVisible } from '../utils/assertions';
import { waitForAppReady, waitForStatePersistence } from '../utils/waits';

// Installs from before #10715 registered ngsw-worker.js directly. The test
// server's "legacy" version is this build with only that registration changed;
// "v2" is the current build, which registers the sw.js entry point.
type PwaVersion = 'legacy' | 'v2';

const setPwaVersion = async (
  request: APIRequestContext,
  version: PwaVersion,
): Promise<void> => {
  const response = await request.post(`/__e2e/pwa/version/${version}`);
  expect(response.ok(), await response.text()).toBeTruthy();
};

const getManifestRequestCount = async (request: APIRequestContext): Promise<number> => {
  const response = await request.get('/__e2e/pwa/manifest-request-count');
  expect(response.ok()).toBeTruthy();
  const count = Number(await response.text());
  expect(Number.isInteger(count)).toBe(true);
  return count;
};

const getControllerScript = (page: Page): Promise<string | null> =>
  page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);

/** Script paths of every worker of every registration, newest first. */
const getRegisteredScripts = (page: Page): Promise<string[][]> =>
  page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.map((registration) =>
      [registration.installing, registration.waiting, registration.active]
        .filter((worker): worker is ServiceWorker => worker !== null)
        .map((worker) => new URL(worker.scriptURL).pathname),
    );
  });

test.describe('Production PWA service worker script switch', () => {
  test.beforeAll(async ({ request }) => {
    await setPwaVersion(request, 'legacy');
  });

  test('moves an ngsw-worker.js install to sw.js without losing data', async ({
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

    // Same controlled-document setup as update-activation.spec.ts.
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
    await page.goto('/?ngsw-bypass=true', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await initialUpdateCheck;
    await expect.poll(() => getControllerScript(page)).toMatch(/\/ngsw-worker\.js$/);
    await expect
      .poll(() => getManifestRequestCount(page.request), { timeout: 15000 })
      .toBeGreaterThanOrEqual(manifestRequestsBeforeControlledReload + 1);
    await page.evaluate(() => history.replaceState(null, '', '/'));

    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-PWA script switch`;
    await workViewPage.addTask(taskTitle);
    await expectTaskVisible(taskPage, taskTitle);
    await waitForStatePersistence(page);

    await setPwaVersion(page.request, 'v2');

    // The app's own update flow: confirm, then reload into the new version.
    const updateDialogPromise = page.waitForEvent('dialog', { timeout: 30000 });
    await page.reload({ waitUntil: 'commit' });
    const updateDialog = await updateDialogPromise;
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

    // The new build registers sw.js; the browser replaces the old worker in
    // the same registration and the new one claims the page.
    await expect
      .poll(() => getControllerScript(page), { timeout: 30000 })
      .toMatch(/\/sw\.js$/);
    await expect
      .poll(() => getRegisteredScripts(page), { timeout: 30000 })
      .toEqual([['/sw.js']]);
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
      await expect.poll(() => getControllerScript(page)).toMatch(/\/sw\.js$/);
      await expectNoGlobalError(page);
    } finally {
      await isolatedContext.setOffline(false);
    }
  });
});
