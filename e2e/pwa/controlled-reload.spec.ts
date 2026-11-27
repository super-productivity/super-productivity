import { expect, test } from '../fixtures/test.fixture';
import { reloadControlledDocument } from './controlled-reload';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/__e2e/pwa/version/legacy');
  expect(response.ok()).toBeTruthy();
});

test('boots a controlled document when cached script streams fail', async ({
  isolatedContext,
  page,
}) => {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state;
        }),
      { timeout: 30000 },
    )
    .toBe('activated');
  const mainScript = await page.locator('script[src*="main-"]').getAttribute('src');
  expect(mainScript).toBeTruthy();

  const worker = isolatedContext
    .serviceWorkers()
    .find((candidate) => candidate.url().endsWith('/ngsw-worker.js'));
  expect(worker).toBeDefined();
  await worker!.evaluate(() => {
    const originalMatch = Cache.prototype.match;
    Cache.prototype.match = async function (...args: Parameters<Cache['match']>) {
      const response = await originalMatch.apply(this, args);
      const request = args[0];
      const url = request instanceof Request ? request.url : String(request);
      if (response && new URL(url, location.origin).pathname.endsWith('.js')) {
        return new Response(
          new ReadableStream({
            start: (controller) => {
              controller.error(new Error('Cached script transport failed'));
            },
          }),
          { headers: response.headers },
        );
      }
      return response;
    };
  });

  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith(`/${mainScript}`)),
    reloadControlledDocument(page, { bypassCachedImports: true }),
  ]);
  expect(response.fromServiceWorker()).toBe(false);
  expect(response.request().headers()['ngsw-bypass']).toBe('true');
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toMatch(/\/ngsw-worker\.js$/);

  // Restoring worker handling must expose the broken stream again.
  await expect(
    page.evaluate((url) => fetch(url!).then((result) => result.text()), mainScript),
  ).rejects.toThrow(/Failed to fetch/);
});
