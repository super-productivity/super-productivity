import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/10170
 * (Schedule view comment)
 *
 * On macOS Electron the whole title bar is dead over the Schedule view: it
 * shows the grab cursor, but the window cannot be dragged.
 *
 * Chromium emits one region per box with an `app-region`, as its unclipped
 * border box, in DOM order. Since Chromium 150 (Electron 44) the property is
 * inherited, so `.route-wrapper { no-drag }` turned every box of the routed
 * page into a no-drag region. The Schedule opens scrolled to the current
 * time, which leaves the grid's upper part laid out behind the header, and
 * that subtracts from the header's drag region across the full width.
 *
 * The OS-level drag cannot run here, and the bundled Playwright Chromium
 * predates the inheritance, so the test checks the invariant instead: no
 * ancestor of the schedule grid declares a region for it to inherit. (An
 * explicit `none` counts as no-drag in Chromium, so a descendant cannot opt
 * out; only the ancestor can.)
 *
 * Run: npm run e2e:file e2e/tests/schedule/schedule-title-bar-drag-10170.spec.ts -- --retries=0
 */
test.describe('Schedule title bar drag region (#10170)', () => {
  test('should not put the scrollable schedule grid under a no-drag region', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('menuitem', { name: 'Schedule' }).click();

    const wrapper = page.locator('schedule .scroll-wrapper');
    await expect(wrapper).toBeVisible();

    const ancestorsWithRegion = await wrapper.evaluate((el) => {
      const found: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const region = getComputedStyle(node).getPropertyValue('-webkit-app-region');
        if (region !== 'none') {
          found.push(`${node.tagName.toLowerCase()}.${node.className}: ${region}`);
        }
      }
      return found;
    });
    expect(ancestorsWithRegion).toEqual([]);
  });
});
