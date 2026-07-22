import { test, expect, Page } from '@playwright/test';
import { skipOnboardingForE2E } from '../../utils/waits';

/**
 * Issue #9187: launching an older build against a database a newer build has
 * already upgraded produces an IndexedDB `VersionError`. `DB_VERSION` 8-10 are
 * deliberate downgrade barriers, so this is a supported rejection of INTACT
 * data — but it was reported through the generic dialog, which blames low disk
 * space and storage corruption and ends with "your browser storage may need to
 * be cleared". Following that advice deletes every task and still does not let
 * the old build open the data.
 *
 * The unit specs pin the classifier and the wording; none of them can show that
 * a real boot against a real downgraded database reaches the dialog at all.
 * That is this test's only job, and it is worth its runtime because the failure
 * mode it guards is silent: if the dialog were bypassed (an unwrapped
 * `VersionError` escaping from some other `SUP_OPS` opener, say) the app would
 * simply show its blank shell and the user would get no message whatsoever.
 *
 * Direction note: we cannot run a v18.14 binary here, so the downgrade is
 * staged from the other side — the on-disk version is pushed one above whatever
 * this build requests, which is the identical `VersionError` the reporter hit,
 * just with the numbers shifted.
 *
 * Run: npm run e2e:file e2e/tests/migration/idb-downgrade-barrier-9187.spec.ts -- --retries=0
 */

/**
 * Push `SUP_OPS` one version above the running build's `DB_VERSION`.
 *
 * Reads the current version rather than hardcoding it, so the test keeps
 * meaning the same thing after the next barrier bump.
 *
 * Every branch resolves with a tag: an IndexedDB request that neither succeeds
 * nor errors (a blocked upgrade) would otherwise hang the evaluate until the
 * test times out with a misleading message.
 */
const bumpDbOneVersionAhead = async (page: Page): Promise<string> =>
  page.evaluate(
    async () =>
      new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('TIMEOUT'), 15000);
        const done = (msg: string): void => {
          clearTimeout(timer);
          resolve(msg);
        };

        const probe = indexedDB.open('SUP_OPS');
        probe.onerror = () => done('PROBE-ERROR');
        probe.onblocked = () => done('PROBE-BLOCKED');
        probe.onsuccess = () => {
          const current = probe.result.version;
          probe.result.close();

          const upgrade = indexedDB.open('SUP_OPS', current + 1);
          upgrade.onerror = () => done('UPGRADE-ERROR');
          upgrade.onblocked = () => done('UPGRADE-BLOCKED');
          // No schema change needed — the version number itself is the barrier.
          upgrade.onupgradeneeded = () => {};
          upgrade.onsuccess = () => {
            const bumped = upgrade.result.version;
            upgrade.result.close();
            done(`OK:${current}->${bumped}`);
          };
        };
      }),
  );

test.describe('@migration #9187 IndexedDB downgrade barrier', () => {
  test('explains the too-old build instead of advising a storage wipe', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
    });

    try {
      // Phase 1 — let the app create a real SUP_OPS at its own DB_VERSION.
      // Corrupting a store the app itself produced beats hand-building one:
      // the surrounding schema is guaranteed real, so the only variable is the
      // version number.
      const appPage = await context.newPage();
      await appPage.addInitScript(skipOnboardingForE2E);
      await appPage.goto('/', { waitUntil: 'domcontentloaded' });
      await appPage.waitForSelector('magic-side-nav', {
        state: 'visible',
        timeout: 30000,
      });

      // Phase 2 — open the mutation page while the app page is still open.
      // Opening it afterwards makes the evaluate below fail to settle (see the
      // #9139 spec, which learned this the expensive way). `**/*.js` is aborted
      // so no second app instance races us for the connection.
      const mutationPage = await context.newPage();
      await mutationPage.route('**/*.js', async (route) => route.abort());
      await mutationPage.goto('/', { waitUntil: 'domcontentloaded' });

      // Phase 3 — close the app so its open connection cannot block the upgrade.
      await appPage.close();

      const bumpResult = await bumpDbOneVersionAhead(mutationPage);
      expect(bumpResult).toMatch(/^OK:\d+->\d+$/);
      await mutationPage.close();

      // Phase 4 — boot again. This build now requests a LOWER version than the
      // one on disk, exactly as an outdated copy would.
      const relaunchPage = await context.newPage();
      await relaunchPage.addInitScript(skipOnboardingForE2E);

      // Register before navigating: the dialog fires during hydration, and
      // Playwright auto-dismisses dialogs when nothing is listening — the
      // message would be gone before we could read it.
      const dialogs: string[] = [];
      relaunchPage.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
      });

      await relaunchPage.goto('/', { waitUntil: 'domcontentloaded' });
      await expect
        .poll(() => dialogs.length, {
          message: 'no dialog appeared — the downgrade failed silently',
          timeout: 45000,
        })
        .toBeGreaterThan(0);

      // Select by the technical detail, which BOTH the old and new wording
      // carry. Selecting by the new title instead would make a regression fail
      // as "no matching dialog" rather than naming the advice that came back.
      const barrierDialog = dialogs.find((m) =>
        m.includes('is less than the existing version'),
      );
      expect(
        barrierDialog,
        `no downgrade dialog; dialogs seen: ${JSON.stringify(dialogs)}`,
      ).toBeDefined();
      const msg = barrierDialog as string;

      // The regression this guards: the destructive advice must be gone.
      // Sabotaging the fix brings back the verbatim #9187 text and fails here.
      expect(msg).not.toContain('storage may need to be cleared');
      expect(msg).not.toContain('Storage corruption');
      expect(msg).not.toContain('Low disk space');

      // And the user is told what actually happened, plus a way out that does
      // not destroy data.
      expect(msg).toContain('This Version Is Too Old');
      expect(msg).toContain('Do NOT clear your storage');
      expect(msg).toContain('make a copy of your Super Productivity');
      // The raw browser detail still reaches bug reports.
      expect(msg).toContain('is less than the existing version');
    } finally {
      await context.close();
    }
  });
});
