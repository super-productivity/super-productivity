import { test, expect } from '@playwright/test';
import { skipOnboardingForE2E } from '../../utils/waits';
import { cssSelectors } from '../../constants/selectors';

const { GLOBAL_ERROR_ALERT, ROUTE_WRAPPER } = cssSelectors;

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7854
 *
 * The app fetches its translation file at runtime via ngx-translate's
 * TranslateHttpLoader (`GET ./assets/i18n/<lang>.json`). When that request
 * fails with a status-0 network error — e.g. the app is opened offline via
 * Safari's Reading List, which serves the HTML snapshot but bypasses the
 * service worker that would otherwise serve the cached `en.json` — the loader
 * has no fallback. The rejected request propagates to `GlobalErrorHandler`,
 * which treats it as a critical error and renders the `.global-error-alert`
 * crash card on top of the app instead of letting it boot.
 *
 * `route.abort('failed')` reproduces the exact failure mode: Angular's
 * HttpClient surfaces an aborted fetch as `HttpErrorResponse { status: 0 }`,
 * which is the `0 Unknown Error` in the report. (The app's
 * NetworkRetryInterceptorService retries the GET once, so the request is
 * aborted twice before the error surfaces — that's expected.)
 *
 * Expected (post-fix): the translation loader degrades gracefully by falling
 * back to the English translations bundled at build time, so the app shell
 * boots, NO crash card appears, AND real translated text renders (not raw keys).
 *
 * This test deliberately uses the base Playwright `test` rather than the shared
 * fixture: the shared `page` fixture auto-navigates and fails the test on any
 * runtime page error, both of which would abort here during setup. We must
 * install the route interception *before* the first navigation, and we expect
 * runtime errors while the bug is present.
 */
test.describe('Offline i18n load failure (#7854)', () => {
  test('should boot with bundled English when the translation file fails to load (status 0)', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Auto-dismiss any blocking dialog so the test asserts on the crash card
      // rather than hanging on a window.confirm/alert.
      page.on('dialog', (dialog) => {
        dialog.dismiss().catch(() => {});
      });

      // Skip onboarding before any app JS runs.
      await page.addInitScript(skipOnboardingForE2E);

      // Simulate the offline / Reading-List case: the app's own translation
      // JSON never loads. Aborting yields the HttpErrorResponse status 0 from
      // the report. Scoped to assets/i18n so plugin i18n files are unaffected.
      await page.route('**/assets/i18n/*.json', (route) => route.abort('failed'));

      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const crashCard = page.locator(GLOBAL_ERROR_ALERT);
      const appShell = page.locator(ROUTE_WRAPPER).first();

      // The crash card appears only after the failed GET + the interceptor's
      // single retry + an async user-data read + a 1.5s reveal timer. We must
      // wait out that whole window: a plain `not.toBeVisible()` would pass
      // instantly (before the card has a chance to render) and miss the bug.
      // While the bug is present this resolves quickly (card appears) and the
      // assertion below fails; once fixed, the card never appears and the
      // waitFor times out, yielding `false`.
      const crashAppeared = await crashCard
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      // Correct behavior: no crash card, and the app shell booted.
      expect(crashAppeared).toBe(false);
      await expect(appShell).toBeVisible();

      // And the bundled English fallback is actually in effect: the side-nav
      // renders translated labels (the `MH.*` keys), not raw keys. Without the
      // fix these would read e.g. "MH.PLANNER". This proves the fix serves real
      // text offline rather than only suppressing the crash card.
      const sideNav = page.locator(cssSelectors.SIDENAV);
      await expect(sideNav).toContainText('Planner', { timeout: 15000 });
      await expect(sideNav).toContainText('Projects');
      await expect(sideNav).not.toContainText('MH.');
    } finally {
      await context.close();
    }
  });
});
