import { expect, test } from '../../fixtures/test.fixture';
import { saveViewEditor, setViewSort, viewEditorSection } from '../../utils/view-helpers';

/**
 * Regression for #7380: editing the default Eisenhower Matrix view and saving
 * it must work. The Formly editor once left Save disabled there (a required
 * match-mode radio never got its default); the view editor keeps Save enabled
 * and saves a tag rule without a match mode as "all".
 */
test.describe('Boards — Eisenhower Matrix edit dialog (#7380)', () => {
  test('saves the default view after changing a sort', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // The Eisenhower Matrix board ships with `cols: 2` and four panels.
    await page.goto('/#/boards/EISENHOWER_MATRIX');
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Default Eisenhower Matrix references Important / Urgent tags that
    // don't exist in a fresh profile — the panels render with a "Create Tags"
    // prompt above them; create the tags if it is shown.
    const createTagsBtn = page.locator('button', { hasText: /create tags?/i });
    if (await createTagsBtn.isVisible().catch(() => false)) {
      await createTagsBtn.click();
    }

    // Open the edit dialog via the per-panel edit (pencil) button.
    const firstPanelEditBtn = page
      .locator('board-panel header')
      .first()
      .getByRole('button', { name: 'Edit', exact: true });
    await expect(firstPanelEditBtn).toBeVisible({ timeout: 10000 });
    await firstPanelEditBtn.click();

    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

    // The first quadrant requires two tags: its rule shows both, matching all.
    const first = viewEditorSection(dialog, 0);
    await expect(
      first.getByRole('combobox', { name: 'Required tag match', exact: true }),
    ).toContainText('Match all (AND)');

    await setViewSort(page, first, 'Title');
    await saveViewEditor(dialog);

    // The sort is stored on that quadrant.
    await firstPanelEditBtn.click();
    await expect(
      viewEditorSection(dialog, 0).getByRole('combobox', {
        name: 'Sort by',
        exact: true,
      }),
    ).toContainText('Title');
  });
});
