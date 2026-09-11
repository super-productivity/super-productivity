import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';

const { DETAIL_PANEL } = cssSelectors;

/**
 * Issue #9910: task notes are edited in an Obsidian-style live editor — one
 * surface that renders markdown while you type, instead of an edit/preview
 * split.
 *
 * What is worth pinning here is the part that is invisible to unit tests: the
 * document keeps the raw markdown while the view hides the syntax, and the
 * checkbox a checklist renders as writes back into that source.
 *
 * Run: npm run e2e:file e2e/tests/task-detail/live-markdown-editor-9910.spec.ts -- --retries=0
 */

test.describe('Live markdown editor (#9910)', () => {
  test('renders markdown inline and toggles a checklist item from its checkbox', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('live markdown task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('live markdown task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    // Always mounted: there is no "edit" mode to enter any more.
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    await editor.click();
    await page.keyboard.type('# A heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] a checklist item');

    // Blur, so no line is revealed as raw source any more.
    await page.keyboard.press('Escape');
    await editor.blur();

    // The heading renders as a heading and its `#` marker is hidden from view,
    // even though the note's text still holds it.
    await expect(notes.locator('.cm-md-h1')).toBeVisible();
    await expect(editor).not.toContainText('# A heading');
    await expect(editor).toContainText('A heading');

    // ...and the source really is untouched: putting the caret back on that
    // line reveals the raw markdown again. This is the round-trip guarantee —
    // nothing is rewritten, only hidden.
    await notes.locator('.cm-md-h1').click();
    await expect(editor).toContainText('# A heading');

    // The checklist prefix renders as a real checkbox (a Material Icons
    // ligature, same as the rendered-markdown path uses).
    const checkbox = notes.locator('.cm-md-task-checkbox');
    await expect(checkbox).toHaveText('check_box_outline_blank');
    await expect(editor).not.toContainText('[ ]');

    // Clicking it edits the source — the line is now `- [x] …`.
    await checkbox.click();
    await expect(checkbox).toHaveText('check_box');
    await expect(notes.locator('.cm-md-task-done')).toBeVisible();
  });

  test('renders an image inline', async ({ page, workViewPage, taskPage }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('image note task');
    await taskPage.openTaskDetail(taskPage.getTaskByText('image note task'));

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.waitFor({ state: 'visible' });

    // A bundled asset stands in for a pasted image: the src resolver only
    // rewrites the app's own indexeddb:// URLs and passes anything else through.
    await editor.click();
    await page.keyboard.type('![an icon](assets/icons/favicon-32x32.png)');
    await editor.blur();

    const img = notes.locator('img.cm-md-image');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'an icon');
    // Visible AND actually decoded — a broken src would still be "visible".
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('opens fullscreen with a single editor and no preview toggle', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('fullscreen live markdown task');
    await taskPage.openTaskDetail(
      taskPage.getTaskByText('fullscreen live markdown task'),
    );

    const notes = page.locator(DETAIL_PANEL).locator('inline-markdown').first();
    await notes.locator('.cm-content').waitFor({ state: 'visible' });

    // The controls are opacity:0 until the notes area is hovered.
    await notes.hover();
    await notes
      .locator('button')
      .filter({ has: page.locator('mat-icon', { hasText: 'fullscreen' }) })
      .first()
      .click();

    const dialog = page.locator('dialog-fullscreen-markdown');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator('.cm-content')).toBeVisible();
    // The EDIT / SPLIT / PARSED toggle is gone: the live editor is all three.
    await expect(dialog.locator('mat-button-toggle-group')).toHaveCount(0);
  });
});
