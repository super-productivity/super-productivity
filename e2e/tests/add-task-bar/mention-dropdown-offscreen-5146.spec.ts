import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issue #5146: on a phone the short-syntax autocomplete "gets stuck outside the
 * screen by the lower side" — the reporter sees a blank strip over the add-task
 * bar's action-chip row and none of the entries.
 *
 * Cause: `:host-context(.isTouchPrimary).global` pins the global add-task bar to
 * the bottom of the screen, but the mention list only ever opened *downwards*
 * from the caret, so the list rendered past the bottom edge. The mat-autocomplete
 * panel next to it already has a touch rule that flips it above the input
 * (`.isTouchPrimary .add-task-bar-panel`); the mention list had no equivalent.
 *
 * Headless Chromium reports a fine pointer, so `InputIntentService` classifies
 * it as `mouseOnly` and never sets the body class — the test sets it directly,
 * which is stable precisely because the service bails out on such devices.
 *
 * Run: npm run e2e:file e2e/tests/add-task-bar/mention-dropdown-offscreen-5146.spec.ts -- --retries=0
 */

// A phone with the on-screen keyboard up: the layout viewport shrinks and the
// bar floats just above the keyboard, leaving almost no room below it.
const PHONE_WITH_KEYBOARD = { width: 390, height: 330 };

test.describe('Add-task-bar mention dropdown', () => {
  test('should stay inside the viewport when the bar is pinned to the bottom', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Enough projects that the `+` list cannot fit in the strip below the bar
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await projectPage.createProject(name);
    }

    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();

    await page.evaluate(() => document.body.classList.add('isTouchPrimary'));

    const addBtn = page.locator('.tour-addBtn');
    await addBtn.waitFor({ state: 'visible', timeout: 20000 });
    await addBtn.click();

    const input = page.locator('add-task-bar.global .main-input').first();
    await input.waitFor({ state: 'visible' });

    await page.setViewportSize(PHONE_WITH_KEYBOARD);
    await input.click();
    await page.keyboard.type('test task +');

    const list = page.locator('mention-list ul');
    await expect(list).toBeVisible();

    const geometry = await page.evaluate(() => {
      const ul = document.querySelector('mention-list ul') as HTMLElement;
      const bar = document.querySelector('add-task-bar.global') as HTMLElement;
      const items = Array.from(ul.querySelectorAll('li')).map(
        (li) => li.getBoundingClientRect().top,
      );
      return {
        viewportHeight: window.innerHeight,
        barTop: bar.getBoundingClientRect().top,
        listBottom: ul.getBoundingClientRect().bottom,
        itemCount: items.length,
        itemsBelowFold: items.filter((top) => top >= window.innerHeight).length,
      };
    });

    // guard the premise: the bar really is pinned to the bottom half
    expect(geometry.barTop).toBeGreaterThan(geometry.viewportHeight / 2);
    expect(geometry.itemCount).toBeGreaterThan(1);

    expect(geometry.itemsBelowFold).toBe(0);
    expect(geometry.listBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  });
});
