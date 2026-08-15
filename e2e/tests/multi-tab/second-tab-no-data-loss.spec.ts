import { expect, test } from '../../fixtures/test.fixture';
import { expectTaskCount } from '../../utils/assertions';

/**
 * Multi-tab smoke test for #9438: a second tab shares the origin's IndexedDB
 * and — although the multi-instance blocker replaces its UI — still hydrates
 * the op log in the background (hydration starts from an APP_INITIALIZER,
 * before the single-instance probe resolves). Its post-replay checkpoint
 * snapshot could historically anchor past ops the first tab appended
 * concurrently, silently dropping them from the next boot's replay.
 *
 * This is a broad safety net, not a deterministic reproduction — the precise
 * race is pinned by the Karma integration specs
 * (multi-tab-frontier-guard.integration.spec.ts). Here: first tab works,
 * a second tab opens mid-session, the first tab keeps working, and after a
 * reload of the first tab every task must still be there.
 */
test.describe('Multi-tab', () => {
  test('second tab must not cause task loss in the first tab after reload', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    const BEFORE_COUNT = 8;
    for (let i = 1; i <= BEFORE_COUNT; i++) {
      await workViewPage.addTask(`before-${i}`);
    }
    await expectTaskCount(taskPage, BEFORE_COUNT);

    // The "second tab": same context = same IndexedDB + localStorage, exactly
    // like a real second browser tab. No error collector on purpose — the
    // blocked tab's torn-down UI may log teardown noise that is not under
    // test here.
    const page2 = await page.context().newPage();
    await page2.goto('/', { waitUntil: 'domcontentloaded' });

    // Keep appending in the first tab while the second tab hydrates — this is
    // the overlap the #9438 guard protects.
    await workViewPage.addTask('after-1');
    await workViewPage.addTask('after-2');
    await expectTaskCount(taskPage, BEFORE_COUNT + 2);

    // The single-instance probe must have blocked the second tab's UI (the
    // first tab responds to the BroadcastChannel probe).
    await expect(page2.getByText('App is already open')).toBeVisible();

    // Let persistence and the second tab's background hydration settle —
    // NgRx effects write outside Angular's zone (same wait as the
    // reload-persistence smoke test in work-view.spec.ts).
    await page.waitForTimeout(1500);
    await page2.close();

    // The first tab's next boot replays snapshot + tail: nothing may be lost.
    await page.reload();
    await workViewPage.waitForTaskList();
    await expectTaskCount(taskPage, BEFORE_COUNT + 2);
    await expect(taskPage.getTaskByText('before-1')).toBeVisible();
    await expect(taskPage.getTaskByText('after-2')).toBeVisible();
  });
});
