import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';
import { cssSelectors } from '../../constants/selectors';

/**
 * Regression for issue #8434 (follow-up): a note edited in the fullscreen
 * markdown editor (outside focus mode) was lost when the window was resized.
 *
 * Crossing the mobile layout breakpoint fires a router navigation; MatDialog's
 * default closeOnNavigation closed the fullscreen editor with no result, so the
 * in-flight note was dropped. The fix opts out of closeOnNavigation and instead
 * closes through the save path, so the navigation persists the note.
 */
test.describe('Detail panel fullscreen note - resize', () => {
  const NOTE_TEXT = 'Note typed before a window resize 8434';

  test('persists a fullscreen note edit when a resize crosses the mobile breakpoint', async ({
    page,
    testPrefix,
    taskPage,
  }) => {
    test.setTimeout(60000);
    const workViewPage = new WorkViewPage(page, testPrefix);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Resize note task');

    const task = page.locator('task').first();
    await expect(task).toBeVisible();
    await taskPage.openTaskDetail(task);

    const detailPanel = page.locator(cssSelectors.DETAIL_PANEL);
    await expect(detailPanel).toBeVisible();

    // Open the fullscreen markdown editor from the notes inline-markdown.
    // The controls are opacity:0 until the notes area is hovered.
    const noteMarkdown = detailPanel.locator('inline-markdown').first();
    await noteMarkdown.hover();
    await noteMarkdown
      .locator('button')
      .filter({ has: page.locator('mat-icon', { hasText: 'fullscreen' }) })
      .first()
      .click();

    const dialog = page.locator('dialog-fullscreen-markdown');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const textarea = dialog.locator('textarea');
    await textarea.click();
    await textarea.fill(NOTE_TEXT);

    // Resize narrow, crossing the 600px breakpoint (desktop right-panel ->
    // mobile bottom sheet). This fires the navigation that used to drop the
    // note; the fix routes it through the save path instead.
    await page.setViewportSize({ width: 480, height: 800 });

    // The fullscreen editor closes via the save path.
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // The note panel re-renders in the mobile bottom sheet, now backed by the
    // persisted task notes: the typed text must have survived the resize.
    await expect(detailPanel.locator('inline-markdown').first()).toContainText(
      NOTE_TEXT,
      {
        timeout: 5000,
      },
    );
  });
});
