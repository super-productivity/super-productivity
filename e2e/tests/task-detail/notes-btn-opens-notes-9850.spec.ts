import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';

const { DETAIL_PANEL, DETAIL_PANEL_BTN } = cssSelectors;

/**
 * Issue #9850: on a phone the notes icon on a task row opened the detail panel
 * bottom sheet with every section collapsed, so reaching the note took a second
 * tap on "Notes". The icon now opens the panel with the notes section expanded
 * (the same target the checklist badge and the N shortcut use).
 *
 * Run: npm run e2e:file e2e/tests/task-detail/notes-btn-opens-notes-9850.spec.ts -- --retries=0
 */

// Below the 600px breakpoint the detail panel renders as the mobile bottom sheet.
const PHONE = { width: 480, height: 800 };
const NOTE_TEXT = 'Note reachable in one tap 9850';

test.describe('Notes icon opens the notes section (#9850)', () => {
  test('should expand the notes section when tapping the notes icon on a phone', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task with a note');

    const task = taskPage.getTaskByText('Task with a note').first();
    await taskPage.openTaskDetail(task);

    const detailPanel = page.locator(DETAIL_PANEL);
    const noteMarkdown = detailPanel.locator('inline-markdown').first();
    // On desktop a fresh task already shows the notes section expanded, so the
    // note can be typed through the inline editor; blur persists it.
    await noteMarkdown.locator('.markdown-parsed').click();
    const textarea = noteMarkdown.locator('textarea');
    await textarea.fill(NOTE_TEXT);
    await textarea.press('Tab');
    await expect(noteMarkdown).toContainText(NOTE_TEXT);

    // Close the panel again; on desktop the row button shows the close icon.
    await task.locator(DETAIL_PANEL_BTN).click();
    await expect(detailPanel).not.toBeVisible();

    await page.setViewportSize(PHONE);

    await task.locator(DETAIL_PANEL_BTN).click();
    await expect(detailPanel).toBeVisible();
    // Before the fix the notes section stayed collapsed in the bottom sheet.
    // mat-expansion-panel keeps collapsed content in the DOM (hidden, height 0),
    // so check the expanded state itself, not just that the text exists.
    const notesItem = detailPanel.locator('task-detail-item', {
      has: page.locator('inline-markdown'),
    });
    await expect(notesItem.locator('mat-expansion-panel')).toHaveClass(/mat-expanded/);
    await expect(notesItem.locator('inline-markdown')).toBeVisible();
    await expect(notesItem.locator('inline-markdown')).toContainText(NOTE_TEXT);
  });
});
