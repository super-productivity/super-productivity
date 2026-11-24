import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import { cssSelectors } from '../../constants/selectors';

/**
 * The fullscreen note editor fills the dialog, so a click in the empty area
 * below a short note still lands in the editor and focuses it — like the old
 * full-height textarea did. Filling the dialog moves scrolling into the editor
 * itself, so a long note must still scroll and keep the caret in view.
 *
 * Run: npm run e2e:file e2e/tests/notes/fullscreen-note-click-to-focus.spec.ts -- --retries=0
 */

const openFullscreenNote = async (page: Page): Promise<Locator> => {
  const noteMarkdown = page
    .locator(cssSelectors.DETAIL_PANEL)
    .locator('inline-markdown')
    .first();
  await noteMarkdown.hover();
  await noteMarkdown
    .locator('button')
    .filter({ has: page.locator('mat-icon', { hasText: 'fullscreen' }) })
    .first()
    .click();
  const dialog = page.locator('dialog-fullscreen-markdown');
  await expect(dialog.locator('.cm-content')).toBeFocused();
  return dialog;
};

test.describe('Fullscreen note editor fills the dialog', () => {
  test('clicking the empty area below the text focuses the editor', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Click to focus note task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('Click to focus note task'));
    const dialog = await openFullscreenNote(page);

    const content = dialog.locator('.cm-content');
    await content.blur();
    await expect(content).not.toBeFocused();

    // Click near the bottom of the editor area, well below the short note text.
    const editorBox = await dialog.locator('live-markdown-editor').boundingBox();
    if (!editorBox) {
      throw new Error('live-markdown-editor has no bounding box');
    }
    const halfWidth = editorBox.width / 2;
    const centerX = editorBox.x + halfWidth;
    await page.mouse.click(centerX, editorBox.y + editorBox.height - 10);

    await expect(content).toBeFocused();
  });

  test('a note longer than the dialog scrolls and keeps the caret in view', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Long note task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('Long note task'));
    const dialog = await openFullscreenNote(page);

    const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(lines.join('\n'));

    const editor = dialog.locator('live-markdown-editor');
    const firstLine = dialog.locator('.cm-line', { hasText: /^line 1$/ });
    const lastLine = dialog.locator('.cm-line', { hasText: /^line 120$/ });

    // Scrolling back to the top with the wheel must reveal the first line.
    await editor.hover();
    await page.mouse.wheel(0, -100000);
    await expect(firstLine).toBeInViewport();
    await expect(lastLine).not.toBeInViewport();

    // ...and back down to the last one.
    await page.mouse.wheel(0, 100000);
    await expect(lastLine).toBeInViewport();

    // Shrink the dialog like an open on-screen keyboard does (height only, so
    // no layout breakpoint is crossed), then type at the end: the caret line
    // must stay visible above the new bottom edge.
    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error('no viewport size');
    }
    await page.setViewportSize({ width: viewport.width, height: 400 });
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' end');
    await expect(
      dialog.locator('.cm-line', { hasText: /^line 120 end$/ }),
    ).toBeInViewport();
  });
});
