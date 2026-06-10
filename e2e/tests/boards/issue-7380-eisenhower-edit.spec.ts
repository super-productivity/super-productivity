import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression for #7380: opening the edit dialog for the default Eisenhower
 * Matrix board left the Save button disabled, because Formly's required
 * `includedTagsMatch` / `excludedTagsMatch` radios never received their
 * `defaultValue` (it was placed inside `props`, which Formly ignores).
 */
test.describe('Boards — Eisenhower Matrix edit dialog (#7380)', () => {
  test('Save is enabled on open and after picking a sortBy', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // The Eisenhower Matrix board ships with `cols: 2` and four panels.
    // Find the Eisenhower tab and select it.
    const eisenhowerTab = page
      .locator('mat-tab-group [role="tab"]')
      .filter({ hasText: /eisenhower/i })
      .first();
    await eisenhowerTab.click();

    // Default Eisenhower Matrix references Important / Urgent tags that
    // don't exist in a fresh profile — click "Create Tags" if shown so the
    // panels actually render.
    const createTagsBtn = page.locator('button', { hasText: /create tags?/i });
    if (await createTagsBtn.isVisible().catch(() => false)) {
      await createTagsBtn.click();
    }

    // Open the edit dialog via the per-panel edit (pencil) button — the only
    // way to edit a board on a desktop viewport without right-click.
    const firstPanelEditBtn = page
      .locator('board-panel header button[mat-icon-button]')
      .first();
    await expect(firstPanelEditBtn).toBeVisible({ timeout: 10000 });
    await firstPanelEditBtn.click();

    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const saveBtn = dialog.locator('button:has(mat-icon:has-text("save"))');
    await expect(saveBtn).toBeVisible();

    // Pre-fix: this expectation fails — the form is invalid on open because
    // `includedTagsMatch` for URGENT_AND_IMPORTANT is required-but-undefined.
    await expect(saveBtn).toBeEnabled();

    // Now exercise the second part of the bug: pick a sort column on the
    // first panel; sortDir radio is revealed with `defaultValue: 'asc'`.
    // Drilling into Formly internals via DOM is fragile, so we just confirm
    // the form stays enabled after toggling the first sort-by select to its
    // first non-manual option.
    const sortBySelect = dialog.locator('mat-select').first();
    await sortBySelect.click();
    // Pick the first option that isn't the currently-selected "manual" entry.
    const sortOption = page.locator('mat-option').nth(1);
    await sortOption.click();

    await expect(saveBtn).toBeEnabled();

    // Click Save and the dialog should close cleanly.
    await saveBtn.click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });
});
